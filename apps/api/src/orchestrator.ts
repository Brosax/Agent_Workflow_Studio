import { readFileSync } from "node:fs";
import { MockAgentProvider, OpenAIResponsesProvider, type AgentProvider } from "@agent-studio/agent-core";
import {
  DEFAULT_USER_ID,
  type ApprovalRequest,
  type AgentArtifactOutput,
  type ArtifactWithContent,
  type OutputFormat,
  type RunEvent,
  type RunEventType,
  type RunInputPayload,
  type RunState,
  type WorkflowConnection,
  type WorkflowDefinition,
  type WorkflowNode
} from "@agent-studio/shared";
import { topologicalSortNodes, getWorkflowConnections } from "@agent-studio/workflow-core";
import { ArtifactManager } from "./artifactManager";
import { StudioDatabase } from "./db";
import { RunEventBus } from "./eventBus";
import { NODE_RUNNERS, getConditionSelectedHandle, type NodeRunnerContext } from "./nodeRunners";
import { WorkflowCatalog } from "./workflows";

export class WorkflowOrchestrator {
  private readonly provider: AgentProvider;

  constructor(
    private readonly db: StudioDatabase,
    private readonly artifactManager: ArtifactManager,
    private readonly eventBus: RunEventBus,
    private readonly workflowCatalog: WorkflowCatalog
  ) {
    this.provider = process.env.AGENT_PROVIDER === "openai_responses"
      ? new OpenAIResponsesProvider()
      : new MockAgentProvider();
  }

  async createRun(workflowId: string, inputPayload: RunInputPayload): Promise<RunState> {
    const workflow = this.workflowCatalog.loadWorkflow(workflowId);
    const orderedNodes = topologicalSortNodes(workflow.nodes);
    const run = this.db.createRun({
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      inputPayload,
      startedBy: DEFAULT_USER_ID,
      startedAt: new Date().toISOString()
    });

    this.db.createNodeRuns(run.id, orderedNodes);
    this.emit(run.id, "workflow_started", "Workflow run started.", { workflowId: workflow.id });

    queueMicrotask(() => {
      void this.continueRun(run.id).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown workflow failure.";
        this.db.updateRunStatus(run.id, "failed", message);
        this.emit(run.id, "workflow_failed", message);
      });
    });

    return this.getRunState(run.id);
  }

  async getRunState(runId: string): Promise<RunState> {
    const run = this.db.getRun(runId);
    const workflow = this.workflowCatalog.loadWorkflow(run.workflowId);
    return {
      run,
      workflow,
      nodeRuns: this.db.listNodeRuns(runId),
      artifacts: this.db.listArtifacts(runId),
      approvals: this.db.listApprovals(runId),
      events: this.db.listEvents(runId)
    };
  }

  async resolveApproval(runId: string, request: ApprovalRequest): Promise<RunState> {
    const pending = this.db.getPendingApproval(runId);
    if (!pending) {
      throw new Error("No pending approval exists for this run.");
    }

    const status = request.action === "approve" ? "approved" : "rejected";
    const approval = this.db.resolveApproval(pending.id, status, request.comment);
    const nodeRuns = this.db.listNodeRuns(runId);
    const approvalNode = nodeRuns.find((nodeRun) => nodeRun.id === approval.nodeRunId);

    if (!approvalNode) {
      throw new Error("Approval node run was not found.");
    }

    this.emit(runId, "approval_resolved", `Approval ${status}.`, {
      approvalId: approval.id,
      comment: request.comment ?? ""
    });

    if (request.action === "reject") {
      this.db.updateNodeStatus(approvalNode.id, "failed", request.comment || "Rejected by reviewer.");
      this.db.updateRunStatus(runId, "cancelled", request.comment || "Rejected by reviewer.");
      this.emit(runId, "workflow_failed", "Workflow cancelled by reviewer.", {
        approvalId: approval.id
      });
      return this.getRunState(runId);
    }

    this.db.updateNodeStatus(approvalNode.id, "succeeded");
    this.db.updateRunStatus(runId, "running");

    queueMicrotask(() => {
      void this.continueRun(runId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown workflow failure.";
        this.db.updateRunStatus(runId, "failed", message);
        this.emit(runId, "workflow_failed", message);
      });
    });

    return this.getRunState(runId);
  }

  async readArtifact(artifactId: string) {
    return this.artifactManager.readArtifact(this.db.getArtifact(artifactId));
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    return this.eventBus.subscribe(runId, listener);
  }

  private async continueRun(runId: string): Promise<void> {
    const run = this.db.getRun(runId);
    if (run.status !== "running") {
      return;
    }

    const workflow = this.workflowCatalog.loadWorkflow(run.workflowId);
    const orderedNodes = topologicalSortNodes(workflow.nodes);
    const connections = getWorkflowConnections(workflow);

    for (const node of orderedNodes) {
      const nodeRun = this.db.getNodeRun(runId, node.id);
      if (nodeRun.status === "succeeded" || nodeRun.status === "skipped") {
        continue;
      }

      if (!this.isNodeActive(runId, workflow, node, connections)) {
        this.db.updateNodeStatus(nodeRun.id, "skipped");
        this.emit(runId, "node_skipped", `${node.name} skipped (inactive branch).`, { nodeId: node.id });
        continue;
      }

      this.assertDependenciesSucceeded(runId, workflow, node);

      if (node.type === "approval") {
        this.requestApproval(runId, node);
        return;
      }

      const runner = NODE_RUNNERS[node.type];
      if (runner) {
        const upstreamArtifacts = await this.readUpstreamArtifacts(runId, workflow, node, connections);
        const ctx: NodeRunnerContext = {
          runId,
          node,
          workflow,
          db: this.db,
          artifactManager: this.artifactManager,
          eventBus: this.eventBus,
          inputPayload: run.inputPayload,
          upstreamArtifacts
        };

        if (node.type === "condition") {
          await runner(ctx);
          this.markInactiveConditionBranches(runId, workflow, node, connections);
          continue;
        }

        await runner(ctx);
        continue;
      }

      if (node.type === "agent" || node.type === "report") {
        await this.runAgentLikeNode(runId, node);
        continue;
      }

      if (node.type === "output") {
        await this.runOutputNode(runId, node);
        continue;
      }

      throw new Error(`Unknown node type: ${node.type}`);
    }

    this.db.updateRunStatus(runId, "completed");
    this.emit(runId, "workflow_completed", "Workflow completed.");
  }

  private isNodeActive(
    runId: string,
    workflow: WorkflowDefinition,
    node: WorkflowNode,
    connections: WorkflowConnection[]
  ): boolean {
    const incomingConnections = connections.filter((c) => c.target === node.id);
    if (incomingConnections.length === 0) {
      return true;
    }

    for (const conn of incomingConnections) {
      if (!conn.sourceHandle || conn.sourceHandle === "main") {
        return true;
      }

      const sourceNode = workflow.nodes.find((n) => n.id === conn.source);
      if (sourceNode?.type === "condition") {
        const sourceRun = this.db.getNodeRun(runId, conn.source);
        if (sourceRun.status === "skipped") {
          continue;
        }
        const selectedHandle = this.getConditionBranch(runId, workflow, sourceNode);
        if (conn.sourceHandle === selectedHandle) {
          return true;
        }
        continue;
      }

      return true;
    }

    return false;
  }

  private getConditionBranch(runId: string, workflow: WorkflowDefinition, conditionNode: WorkflowNode): "true" | "false" {
    const artifacts = this.db.listArtifactsForNode(runId, conditionNode.id);
    const conditionResult = artifacts.find((a) => a.name === "condition_result.json");
    if (conditionResult) {
      try {
        const content = JSON.parse(
          readFileSync(conditionResult.contentPath, "utf8")
        ) as { selectedBranch?: string };
        if (content.selectedBranch === "true" || content.selectedBranch === "false") {
          return content.selectedBranch;
        }
      } catch {
        // fall through
      }
    }
    return "true";
  }

  private markInactiveConditionBranches(
    runId: string,
    workflow: WorkflowDefinition,
    conditionNode: WorkflowNode,
    connections: WorkflowConnection[]
  ): void {
    const selectedHandle = this.getConditionBranch(runId, workflow, conditionNode);
    const outgoingConnections = connections.filter((c) => c.source === conditionNode.id);

    for (const conn of outgoingConnections) {
      if (conn.sourceHandle && conn.sourceHandle !== selectedHandle) {
        const targetNode = workflow.nodes.find((n) => n.id === conn.target);
        if (targetNode) {
          const targetRun = this.db.getNodeRun(runId, targetNode.id);
          if (targetRun.status === "pending") {
            this.db.updateNodeStatus(targetRun.id, "skipped");
            this.emit(runId, "node_skipped", `${targetNode.name} skipped (inactive branch).`, { nodeId: targetNode.id });
          }
        }
      }
    }
  }

  private async readUpstreamArtifacts(
    runId: string,
    workflow: WorkflowDefinition,
    node: WorkflowNode,
    connections: WorkflowConnection[]
  ): Promise<ArtifactWithContent[]> {
    const upstreamNodeIds = new Set<string>();

    for (const dep of node.depends_on ?? []) {
      upstreamNodeIds.add(dep);
    }
    for (const conn of connections) {
      if (conn.target === node.id) {
        upstreamNodeIds.add(conn.source);
      }
    }

    const artifacts: ArtifactWithContent[] = [];
    for (const upstreamId of upstreamNodeIds) {
      const upstreamArtifacts = this.db.listArtifactsForNode(runId, upstreamId);
      for (const artifact of upstreamArtifacts) {
        artifacts.push(await this.artifactManager.readArtifact(artifact));
      }
    }
    return artifacts;
  }

  private assertDependenciesSucceeded(runId: string, workflow: WorkflowDefinition, node: WorkflowNode): void {
    for (const dependencyId of node.depends_on ?? []) {
      const dependency = workflow.nodes.find((candidate) => candidate.id === dependencyId);
      if (!dependency) {
        throw new Error(`Missing dependency ${dependencyId} for node ${node.id}.`);
      }

      const dependencyRun = this.db.getNodeRun(runId, dependency.id);
      if (dependencyRun.status !== "succeeded" && dependencyRun.status !== "skipped") {
        throw new Error(`Dependency ${dependency.id} has not succeeded.`);
      }
    }
  }

  private async runAgentLikeNode(runId: string, node: WorkflowNode): Promise<void> {
    const run = this.db.getRun(runId);
    const nodeRun = this.db.getNodeRun(runId, node.id);
    const runningNode = this.db.updateNodeStatus(nodeRun.id, "running");
    this.emit(runId, "node_started", `${node.name} started.`, { nodeId: node.id });

    try {
      const previousArtifacts = await this.artifactManager.readArtifacts(this.db.listArtifacts(runId));
      const agent = this.db.getAgentOptional(node.agentId);
      const skills = this.db.listSkillsByIds([...(node.skillIds ?? []), ...(agent?.skillIds ?? [])]);
      const result = await this.provider.run({
        node,
        runId,
        inputPayload: run.inputPayload,
        previousArtifacts,
        agent,
        skills
      });

      for (const output of result.artifacts) {
        const artifact = await this.artifactManager.saveArtifact({ runId, nodeRun: runningNode, output });
        this.emit(runId, "artifact_created", `${artifact.name} created.`, {
          nodeId: node.id,
          artifactId: artifact.id,
          name: artifact.name
        });
      }

      this.db.updateNodeStatus(nodeRun.id, "succeeded");
      this.emit(runId, "node_succeeded", `${node.name} completed.`, {
        nodeId: node.id,
        summary: result.summary,
        nextActions: result.nextActions,
        risks: result.risks
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent execution failed.";
      this.db.updateNodeStatus(nodeRun.id, "failed", message);
      this.db.updateRunStatus(runId, "failed", message);
      this.emit(runId, "node_failed", `${node.name} failed: ${message}`, { nodeId: node.id });
      this.emit(runId, "workflow_failed", message, { nodeId: node.id });
      throw error;
    }
  }

  private requestApproval(runId: string, node: WorkflowNode): void {
    const nodeRun = this.db.getNodeRun(runId, node.id);
    if (nodeRun.status === "waiting_approval") {
      return;
    }

    const waitingNode = this.db.updateNodeStatus(nodeRun.id, "waiting_approval");
    const approval = this.db.createApproval({
      id: crypto.randomUUID(),
      workflowRunId: runId,
      nodeRunId: waitingNode.id,
      requestedBy: node.id
    });

    this.db.updateRunStatus(runId, "waiting_approval");
    this.emit(runId, "approval_requested", `${node.name} is waiting for approval.`, {
      approvalId: approval.id,
      nodeId: node.id
    });
  }

  private async runOutputNode(runId: string, node: WorkflowNode): Promise<void> {
    const nodeRun = this.db.getNodeRun(runId, node.id);
    const runningNode = this.db.updateNodeStatus(nodeRun.id, "running");
    this.emit(runId, "node_started", `${node.name} started.`, { nodeId: node.id });

    try {
      const previousArtifacts = await this.artifactManager.readArtifacts(this.db.listArtifacts(runId));
      const formats = node.outputConfig?.formats?.length ? node.outputConfig.formats : (["markdown"] satisfies OutputFormat[]);
      const baseName = node.outputConfig?.artifactName || node.outputs?.[0]?.replace(/\.[^.]+$/, "") || node.id;
      const combined = previousArtifacts.length
        ? previousArtifacts.map((artifact) => `## ${artifact.name}\n\n${artifact.content.trim()}`).join("\n\n")
        : "No previous artifacts were available.";
      const outputs = formats.map((format) => buildOutputArtifact(baseName, format, node, combined));

      for (const output of outputs) {
        const artifact = await this.artifactManager.saveArtifact({ runId, nodeRun: runningNode, output });
        this.emit(runId, "artifact_created", `${artifact.name} created.`, {
          nodeId: node.id,
          artifactId: artifact.id,
          name: artifact.name
        });
      }

      this.db.updateNodeStatus(nodeRun.id, "succeeded");
      this.emit(runId, "node_succeeded", `${node.name} completed.`, { nodeId: node.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Output generation failed.";
      this.db.updateNodeStatus(nodeRun.id, "failed", message);
      this.db.updateRunStatus(runId, "failed", message);
      this.emit(runId, "node_failed", `${node.name} failed: ${message}`, { nodeId: node.id });
      this.emit(runId, "workflow_failed", message, { nodeId: node.id });
      throw error;
    }
  }

  private emit(
    workflowRunId: string,
    type: RunEventType,
    message: string,
    payload?: Record<string, unknown>
  ): RunEvent {
    const event = this.db.createEvent({
      workflowRunId,
      nodeId: typeof payload?.nodeId === "string" ? payload.nodeId : undefined,
      type,
      message,
      payload
    });
    this.eventBus.publish(event);
    return event;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOutputArtifact(
  baseName: string,
  format: OutputFormat,
  node: WorkflowNode,
  combined: string
): AgentArtifactOutput {
  const extension = format === "markdown" ? "md" : format;
  const name = `${baseName.replace(/\.[^.]+$/, "")}.${extension}`;
  const content = `# ${node.name}

## Generated Output

${combined}
`;
  return {
    name,
    type: format,
    content: format === "json"
      ? JSON.stringify({ nodeId: node.id, generatedAt: new Date().toISOString(), content }, null, 2)
      : content
  };
}
