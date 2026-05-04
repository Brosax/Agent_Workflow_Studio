import { parse } from "yaml";
import type {
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowNode
} from "@agent-studio/shared";

const VALID_NODE_TYPES = new Set([
  "input",
  "agent",
  "approval",
  "output",
  "report",
  "trigger",
  "model_selector",
  "tool_executor",
  "document_loader",
  "retriever",
  "condition",
  "merge",
  "filter"
]);

const CONDITION_HANDLES = new Set(["true", "false"]);

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

  if (!workflow.nodes.some((node) => node.type === "input" || node.type === "trigger")) {
    throw new Error("Workflow definition requires at least one input or trigger node.");
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

  if (workflow.connections) {
    validateConnections(workflow.connections, ids, workflow.nodes);
  }

  const effectiveDeps = buildEffectiveDependencies(workflow);
  topologicalSortNodes(workflow.nodes, effectiveDeps);
}

export function getWorkflowConnections(workflow: WorkflowDefinition): WorkflowConnection[] {
  return workflow.connections ?? [];
}

export function connectionsToDependsOn(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[]
): WorkflowNode[] {
  const depsByTarget = new Map<string, string[]>();

  for (const conn of connections) {
    const existing = depsByTarget.get(conn.target) ?? [];
    if (!existing.includes(conn.source)) {
      existing.push(conn.source);
    }
    depsByTarget.set(conn.target, existing);
  }

  return nodes.map((node) => {
    const deps = depsByTarget.get(node.id) ?? [];
    if (deps.length === 0 && (!node.depends_on || node.depends_on.length === 0)) {
      return { ...node, depends_on: [] };
    }
    return { ...node, depends_on: deps.length > 0 ? deps : (node.depends_on ?? []) };
  });
}

export function topologicalSortNodes(
  nodes: WorkflowNode[],
  effectiveDeps?: Map<string, string[]>
): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sorted: WorkflowNode[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();

  function getDeps(nodeId: string): string[] {
    if (effectiveDeps) {
      return effectiveDeps.get(nodeId) ?? [];
    }
    const node = byId.get(nodeId);
    return node?.depends_on ?? [];
  }

  function visit(nodeId: string): void {
    if (permanent.has(nodeId)) {
      return;
    }

    if (temporary.has(nodeId)) {
      throw new Error(`Workflow has a dependency cycle involving node ${nodeId}.`);
    }

    temporary.add(nodeId);

    for (const dependencyId of getDeps(nodeId)) {
      if (!byId.has(dependencyId)) {
        throw new Error(`Node ${nodeId} depends on missing node ${dependencyId}.`);
      }
      visit(dependencyId);
    }

    temporary.delete(nodeId);
    permanent.add(nodeId);
    sorted.push(byId.get(nodeId)!);
  }

  for (const node of nodes) {
    visit(node.id);
  }

  return sorted;
}

export function getNextNodes(nodes: WorkflowNode[], nodeId: string): WorkflowNode[] {
  return nodes.filter((node) => (node.depends_on ?? []).includes(nodeId));
}

function validateConnections(
  connections: WorkflowConnection[],
  nodeIds: Set<string>,
  nodes: WorkflowNode[]
): void {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (const conn of connections) {
    if (!conn.id || !conn.source || !conn.target) {
      throw new Error(`Invalid connection: ${JSON.stringify(conn)}`);
    }

    if (!nodeIds.has(conn.source)) {
      throw new Error(`Connection ${conn.id} references missing source node ${conn.source}.`);
    }

    if (!nodeIds.has(conn.target)) {
      throw new Error(`Connection ${conn.id} references missing target node ${conn.target}.`);
    }

    if (conn.source === conn.target) {
      throw new Error(`Connection ${conn.id} creates a self-loop on node ${conn.source}.`);
    }

    if (conn.sourceHandle && !CONDITION_HANDLES.has(conn.sourceHandle) && conn.sourceHandle !== "main") {
      throw new Error(`Connection ${conn.id} has invalid sourceHandle ${conn.sourceHandle}.`);
    }

    const sourceNode = nodeById.get(conn.source);
    if (sourceNode?.type === "condition") {
      if (!conn.sourceHandle || !CONDITION_HANDLES.has(conn.sourceHandle)) {
        throw new Error(
          `Connection ${conn.id} from condition node ${conn.source} must have sourceHandle "true" or "false".`
        );
      }
    }
  }
}

function buildEffectiveDependencies(workflow: WorkflowDefinition): Map<string, string[]> {
  const deps = new Map<string, string[]>();

  for (const node of workflow.nodes) {
    deps.set(node.id, [...(node.depends_on ?? [])]);
  }

  if (workflow.connections) {
    for (const conn of workflow.connections) {
      const existing = deps.get(conn.target) ?? [];
      if (!existing.includes(conn.source)) {
        existing.push(conn.source);
      }
      deps.set(conn.target, existing);
    }
  }

  return deps;
}
