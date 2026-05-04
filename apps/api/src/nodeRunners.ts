import {
  type AgentArtifactOutput,
  type ArtifactWithContent,
  type ConditionOperator,
  type ConditionSource,
  type WorkflowDefinition,
  type WorkflowNode
} from "@agent-studio/shared";
import type { ArtifactManager } from "./artifactManager";
import type { StudioDatabase } from "./db";
import type { RunEventBus } from "./eventBus";

export interface NodeRunnerContext {
  runId: string;
  node: WorkflowNode;
  workflow: WorkflowDefinition;
  db: StudioDatabase;
  artifactManager: ArtifactManager;
  eventBus: RunEventBus;
  inputPayload: import("@agent-studio/shared").RunInputPayload;
  upstreamArtifacts: ArtifactWithContent[];
}

export type NodeRunner = (ctx: NodeRunnerContext) => Promise<"succeeded" | "skipped">;

export const NODE_RUNNERS: Record<string, NodeRunner> = {
  trigger: runTrigger,
  input: runInput,
  model_selector: runModelSelector,
  tool_executor: runToolExecutor,
  document_loader: runDocumentLoader,
  retriever: runRetriever,
  condition: runCondition,
  merge: runMerge,
  filter: runFilter
};

async function runTrigger(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} triggered.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

async function runInput(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const summary = {
    sourceLabel: ctx.inputPayload.sourceLabel,
    contextNote: ctx.inputPayload.contextNote,
    fileCount: ctx.inputPayload.files.length,
    files: ctx.inputPayload.files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    hasDiff: Boolean(ctx.inputPayload.prDiff)
  };

  const output: AgentArtifactOutput = {
    name: "input_summary.json",
    type: "json",
    content: JSON.stringify(summary, null, 2)
  };

  const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "artifact_created",
      message: `${artifact.name} created.`,
      payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name }
    })
  );

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

async function runModelSelector(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const config = ctx.node.modelSelectorConfig;
  if (!config?.provider) {
    throw new Error(`Model selector node ${ctx.node.id} requires a provider configuration.`);
  }

  const modelContext = {
    provider: config.provider,
    model: config.model || "default",
    selectedAt: new Date().toISOString()
  };

  const output: AgentArtifactOutput = {
    name: "model_context.json",
    type: "json",
    content: JSON.stringify(modelContext, null, 2)
  };

  const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "artifact_created",
      message: `${artifact.name} created.`,
      payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name }
    })
  );

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

async function runToolExecutor(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const toolKind = ctx.node.toolExecutorConfig?.toolKind;
  if (!toolKind) {
    throw new Error(`Tool executor node ${ctx.node.id} requires a toolKind configuration.`);
  }

  let resultContent: string;

  switch (toolKind) {
    case "git_status": {
      resultContent = JSON.stringify(
        { tool: "git_status", note: "Git status is not available in MVP mock mode.", timestamp: new Date().toISOString() },
        null,
        2
      );
      break;
    }
    case "list_input_files": {
      const files = ctx.inputPayload.files.map((f) => ({ name: f.name, size: f.size, type: f.type }));
      resultContent = JSON.stringify({ tool: "list_input_files", files, count: files.length }, null, 2);
      break;
    }
    case "d_rd_cli_status": {
      resultContent = JSON.stringify(
        { tool: "d_rd_cli_status", status: "available", note: "D_RD CLI status check (MVP mock)", timestamp: new Date().toISOString() },
        null,
        2
      );
      break;
    }
    default:
      throw new Error(`Unsupported tool kind: ${toolKind}`);
  }

  const output: AgentArtifactOutput = {
    name: "tool_result.json",
    type: "json",
    content: resultContent
  };

  const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "artifact_created",
      message: `${artifact.name} created.`,
      payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name }
    })
  );

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

async function runDocumentLoader(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const source = ctx.node.documentLoaderConfig?.source ?? "both";
  const documents: Array<{ id: string; name: string; source: string; content: string; size: number }> = [];

  if (source === "input_files" || source === "both") {
    for (const file of ctx.inputPayload.files) {
      documents.push({
        id: file.id,
        name: file.name,
        source: "input",
        content: file.content,
        size: file.size
      });
    }
  }

  if (source === "upstream_artifacts" || source === "both") {
    for (const artifact of ctx.upstreamArtifacts) {
      documents.push({
        id: artifact.id,
        name: artifact.name,
        source: "artifact",
        content: artifact.content,
        size: artifact.content.length
      });
    }
  }

  const output: AgentArtifactOutput = {
    name: "documents.json",
    type: "json",
    content: JSON.stringify({ documents, count: documents.length, loadedAt: new Date().toISOString() }, null, 2)
  };

  const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "artifact_created",
      message: `${artifact.name} created.`,
      payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name }
    })
  );

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

async function runRetriever(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const query = ctx.node.retrieverConfig?.query ?? ctx.inputPayload.contextNote ?? "";
  const topK = ctx.node.retrieverConfig?.topK ?? 5;

  const allTexts = [
    ...ctx.inputPayload.files.map((f) => ({ name: f.name, content: f.content, source: "input" as const })),
    ...ctx.upstreamArtifacts.map((a) => ({ name: a.name, content: a.content, source: "artifact" as const }))
  ];

  const queryLower = query.toLowerCase();
  const scored = allTexts
    .map((doc) => {
      const contentLower = doc.content.toLowerCase();
      const matches = queryLower.split(/\s+/).filter((term) => term && contentLower.includes(term));
      return { ...doc, score: matches.length };
    })
    .filter((doc) => doc.score > 0 || !query.trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const retrieved = scored.map((doc) => `## ${doc.name} (${doc.source}, score: ${doc.score})\n\n${doc.content.trim()}`).join("\n\n---\n\n");
  const retrievedJson = scored.map((doc) => ({ name: doc.name, source: doc.source, score: doc.score, preview: doc.content.slice(0, 200) }));

  const mdOutput: AgentArtifactOutput = { name: "retrieved_context.md", type: "markdown", content: retrieved || "No matching documents found." };
  const jsonOutput: AgentArtifactOutput = { name: "retrieved_context.json", type: "json", content: JSON.stringify({ query, topK, results: retrievedJson, count: retrievedJson.length }, null, 2) };

  for (const output of [mdOutput, jsonOutput]) {
    const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
    ctx.eventBus.publish(
      ctx.db.createEvent({
        workflowRunId: ctx.runId,
        nodeId: ctx.node.id,
        type: "artifact_created",
        message: `${artifact.name} created.`,
        payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name }
      })
    );
  }

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

async function runCondition(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const config = ctx.node.conditionConfig;
  if (!config) {
    throw new Error(`Condition node ${ctx.node.id} requires conditionConfig.`);
  }

  const testValue = resolveConditionSource(config.source, ctx);
  const result = evaluateCondition(config.operator, testValue, config.value);

  const output: AgentArtifactOutput = {
    name: "condition_result.json",
    type: "json",
    content: JSON.stringify(
      {
        source: config.source,
        operator: config.operator,
        expectedValue: config.value,
        testValue: testValue?.slice(0, 200),
        result,
        selectedBranch: result ? "true" : "false",
        evaluatedAt: new Date().toISOString()
      },
      null,
      2
    )
  };

  const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "artifact_created",
      message: `${artifact.name} created.`,
      payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name, conditionResult: result }
    })
  );

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed. Branch: ${result ? "true" : "false"}.`,
      payload: { nodeId: ctx.node.id, conditionResult: result, selectedBranch: result ? "true" : "false" }
    })
  );
  return "succeeded";
}

async function runMerge(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const merged = ctx.upstreamArtifacts
    .map((artifact) => `## ${artifact.name}\n\n${artifact.content.trim()}`)
    .join("\n\n---\n\n");

  const output: AgentArtifactOutput = {
    name: "merged_context.md",
    type: "markdown",
    content: merged || "No upstream artifacts to merge."
  };

  const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "artifact_created",
      message: `${artifact.name} created.`,
      payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name }
    })
  );

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

async function runFilter(ctx: NodeRunnerContext): Promise<"succeeded"> {
  const nodeRun = ctx.db.getNodeRun(ctx.runId, ctx.node.id);
  ctx.db.updateNodeStatus(nodeRun.id, "running");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_started",
      message: `${ctx.node.name} started.`,
      payload: { nodeId: ctx.node.id }
    })
  );

  const config = ctx.node.filterConfig;
  if (!config?.value) {
    throw new Error(`Filter node ${ctx.node.id} requires filterConfig with a value.`);
  }

  const combined = ctx.upstreamArtifacts.map((a) => a.content).join("\n");
  const filterValue = config.value.toLowerCase();
  const lines = combined.split("\n");
  const filtered = config.operator === "contains"
    ? lines.filter((line) => line.toLowerCase().includes(filterValue))
    : lines.filter((line) => !line.toLowerCase().includes(filterValue));

  const output: AgentArtifactOutput = {
    name: "filtered_context.md",
    type: "markdown",
    content: filtered.join("\n") || "No content matched the filter criteria."
  };

  const artifact = await ctx.artifactManager.saveArtifact({ runId: ctx.runId, nodeRun, output });
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "artifact_created",
      message: `${artifact.name} created.`,
      payload: { nodeId: ctx.node.id, artifactId: artifact.id, name: artifact.name }
    })
  );

  ctx.db.updateNodeStatus(nodeRun.id, "succeeded");
  ctx.eventBus.publish(
    ctx.db.createEvent({
      workflowRunId: ctx.runId,
      nodeId: ctx.node.id,
      type: "node_succeeded",
      message: `${ctx.node.name} completed.`,
      payload: { nodeId: ctx.node.id }
    })
  );
  return "succeeded";
}

function resolveConditionSource(source: ConditionSource, ctx: NodeRunnerContext): string | undefined {
  switch (source) {
    case "context_note":
      return ctx.inputPayload.contextNote;
    case "optional_diff":
      return ctx.inputPayload.prDiff;
    case "combined_artifacts":
      return ctx.upstreamArtifacts.map((a) => a.content).join("\n");
    default:
      return undefined;
  }
}

function evaluateCondition(operator: ConditionOperator, testValue: string | undefined, expectedValue: string | undefined): boolean {
  switch (operator) {
    case "exists":
      return Boolean(testValue && testValue.trim().length > 0);
    case "contains":
      return Boolean(testValue && expectedValue && testValue.toLowerCase().includes(expectedValue.toLowerCase()));
    case "not_contains":
      return Boolean(testValue && expectedValue && !testValue.toLowerCase().includes(expectedValue.toLowerCase()));
    case "equals":
      return testValue?.trim() === expectedValue?.trim();
    default:
      return false;
  }
}

export function getConditionSelectedHandle(ctx: NodeRunnerContext): "true" | "false" {
  const config = ctx.node.conditionConfig;
  if (!config) return "true";
  const testValue = resolveConditionSource(config.source, ctx);
  return evaluateCondition(config.operator, testValue, config.value) ? "true" : "false";
}
