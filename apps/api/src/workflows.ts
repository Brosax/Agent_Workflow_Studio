import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowDefinition,
  WorkflowSummary
} from "@agent-studio/shared";
import { normalizeWorkflowConnections } from "@agent-studio/shared";
import { parseWorkflowDefinition, validateWorkflowDefinition } from "@agent-studio/workflow-core";
import { workflowsDir } from "./config";
import { StudioDatabase } from "./db";

export class WorkflowCatalog {
  constructor(private readonly db: StudioDatabase) {}

  async seedFromYamlIfNeeded(): Promise<void> {
    if (this.db.hasWorkflows()) {
      return;
    }

    const yamlText = await readFile(path.join(workflowsDir, "code-review.yaml"), "utf8");
    const workflow = parseWorkflowDefinition(yamlText);
    this.db.upsertWorkflow({
      ...workflow,
      status: "active",
      template: true,
      nodes: workflow.nodes.map((node, index) => ({
        ...node,
        position: { x: 220 + index * 60, y: 80 + index * 132 }
      }))
    });
  }

  listWorkflows(): WorkflowSummary[] {
    return this.db.listWorkflows();
  }

  loadWorkflow(workflowId: string): WorkflowDefinition {
    return this.db.getWorkflow(workflowId);
  }

  createWorkflow(request: CreateWorkflowRequest): WorkflowDefinition {
    const workflow = request.template === "code-review"
      ? this.duplicateSeedWorkflow(request)
      : createBlankWorkflow(request);
    validateWorkflowDefinition(workflow);
    return this.db.createWorkflow(workflow);
  }

  updateWorkflow(workflowId: string, request: UpdateWorkflowRequest): WorkflowDefinition {
    const workflow = {
      ...request.workflow,
      id: workflowId,
      updatedAt: new Date().toISOString(),
      connections: request.workflow.connections
        ? normalizeWorkflowConnections(request.workflow.connections)
        : request.workflow.connections
    };
    validateWorkflowDefinition(workflow);
    return this.db.upsertWorkflow(workflow);
  }

  duplicateWorkflow(workflowId: string): WorkflowDefinition {
    const source = this.db.getWorkflow(workflowId);
    const duplicated: WorkflowDefinition = {
      ...source,
      id: uniqueWorkflowId(source.name),
      name: `${source.name} Copy`,
      template: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return this.db.createWorkflow(duplicated);
  }

  deleteWorkflow(workflowId: string): void {
    this.db.deleteWorkflow(workflowId);
  }

  validateWorkflow(workflow: WorkflowDefinition): { ok: true } {
    validateWorkflowDefinition(workflow);
    return { ok: true };
  }

  private duplicateSeedWorkflow(request: CreateWorkflowRequest): WorkflowDefinition {
    const source = this.db.getWorkflow("code-review");
    return {
      ...source,
      id: uniqueWorkflowId(request.name ?? source.name),
      name: request.name ?? `${source.name} Copy`,
      description: request.description ?? source.description,
      template: false,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}

function createBlankWorkflow(request: CreateWorkflowRequest): WorkflowDefinition {
  const now = new Date().toISOString();
  const name = request.name?.trim() || "Untitled Workflow";
  return {
    id: uniqueWorkflowId(name),
    name,
    description: request.description?.trim() || "Custom local workflow",
    version: 1,
    status: "draft",
    template: false,
    createdAt: now,
    updatedAt: now,
    inputs: {
      local_files: {
        type: "files",
        required: true,
        label: "Local Files"
      },
      context_note: {
        type: "text",
        required: false,
        label: "Context"
      }
    },
    nodes: [
      {
        id: "input",
        type: "input",
        name: "File Input",
        description: "Collects local files and freeform context.",
        position: { x: 120, y: 120 },
        inputConfig: { acceptsFiles: true, acceptsText: true, label: "Local files" }
      },
      {
        id: "agent_1",
        type: "agent",
        name: "Analysis Agent",
        description: "Reads the input and creates a structured draft artifact.",
        depends_on: ["input"],
        position: { x: 440, y: 120 },
        model: "mock",
        prompt: "Summarize the selected files and recommend next actions.",
        outputs: ["analysis.md"],
        outputConfig: { formats: ["markdown"], artifactName: "analysis" }
      },
      {
        id: "output",
        type: "output",
        name: "Final Output",
        description: "Converts prior artifacts into Markdown, HTML, and PDF outputs.",
        depends_on: ["agent_1"],
        position: { x: 760, y: 120 },
        outputs: ["final_output.md", "final_output.html", "final_output.pdf"],
        outputConfig: { formats: ["markdown", "html", "pdf"], artifactName: "final_output" }
      }
    ]
  };
}

function uniqueWorkflowId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 38) || "workflow";
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}
