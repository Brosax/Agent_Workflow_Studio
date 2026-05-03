import { parse } from "yaml";
import type { WorkflowDefinition, WorkflowNode } from "@agent-studio/shared";

const VALID_NODE_TYPES = new Set(["input", "agent", "approval", "output", "report"]);

export function parseWorkflowDefinition(yamlText: string): WorkflowDefinition {
  const parsed = parse(yamlText) as WorkflowDefinition;
  validateWorkflowDefinition(parsed);
  return parsed;
}

export function validateWorkflowDefinition(workflow: WorkflowDefinition): void {
  if (!workflow || typeof workflow !== "object") {
    throw new Error("Workflow definition must be an object.");
  }

  if (!workflow.id || !workflow.name || !workflow.version) {
    throw new Error("Workflow definition requires id, name, and version.");
  }

  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    throw new Error("Workflow definition requires at least one node.");
  }

  if (!workflow.nodes.some((node) => node.type === "input")) {
    throw new Error("Workflow definition requires at least one input node.");
  }

  if (!workflow.nodes.some((node) => node.type === "output" || node.type === "report")) {
    throw new Error("Workflow definition requires at least one output node.");
  }

  const ids = new Set<string>();

  for (const node of workflow.nodes) {
    if (!node.id || !node.name || !VALID_NODE_TYPES.has(node.type)) {
      throw new Error(`Invalid workflow node: ${JSON.stringify(node)}`);
    }

    if (ids.has(node.id)) {
      throw new Error(`Duplicate workflow node id: ${node.id}`);
    }

    ids.add(node.id);
  }

  for (const node of workflow.nodes) {
    for (const dependency of node.depends_on ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`Node ${node.id} depends on missing node ${dependency}.`);
      }
    }
  }

  topologicalSortNodes(workflow.nodes);
}

export function topologicalSortNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sorted: WorkflowNode[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();

  function visit(node: WorkflowNode): void {
    if (permanent.has(node.id)) {
      return;
    }

    if (temporary.has(node.id)) {
      throw new Error(`Workflow has a dependency cycle involving node ${node.id}.`);
    }

    temporary.add(node.id);

    for (const dependencyId of node.depends_on ?? []) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new Error(`Node ${node.id} depends on missing node ${dependencyId}.`);
      }
      visit(dependency);
    }

    temporary.delete(node.id);
    permanent.add(node.id);
    sorted.push(node);
  }

  for (const node of nodes) {
    visit(node);
  }

  return sorted;
}

export function getNextNodes(nodes: WorkflowNode[], nodeId: string): WorkflowNode[] {
  return nodes.filter((node) => (node.depends_on ?? []).includes(nodeId));
}
