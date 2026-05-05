import type { Connection, Edge } from "@xyflow/react";
import {
  createConnectionId,
  getNodePorts,
  normalizeConnectionHandle,
  normalizeWorkflowConnection,
  type NodeRun,
  type StandardWorkflowConnectionHandle,
  type WorkflowConnection,
  type WorkflowDefinition,
  type WorkflowNode
} from "@agent-studio/shared";

export interface WorkflowEdgeData extends Record<string, unknown> {
  sourceLabel: string;
  targetLabel: string;
  sourceHandle: StandardWorkflowConnectionHandle;
  targetHandle: StandardWorkflowConnectionHandle;
  onDeleteEdge?: (edgeId: string) => void;
  onInsertEdge?: (edgeId: string) => void;
}

export type WorkflowEdge = Edge<WorkflowEdgeData>;

interface EdgeBuildOptions {
  nodeRunsByNodeId?: Map<string, NodeRun>;
  onDeleteEdge?: (edgeId: string) => void;
  onInsertEdge?: (edgeId: string) => void;
}

interface ConnectionResult {
  connection?: WorkflowConnection;
  error?: string;
}

export function workflowConnectionsToEdges(
  workflow: WorkflowDefinition,
  options: EdgeBuildOptions = {}
): WorkflowEdge[] {
  return (workflow.connections ?? []).map((connection) => workflowConnectionToEdge(workflow, connection, options));
}

export function dependsOnToEdges(workflow: WorkflowDefinition, options: EdgeBuildOptions = {}): WorkflowEdge[] {
  return workflow.nodes.flatMap((node) =>
    (node.depends_on ?? []).map((dependency) =>
      workflowConnectionToEdge(
        workflow,
        {
          id: createConnectionId(dependency, undefined, node.id, undefined),
          source: dependency,
          target: node.id
        },
        options
      )
    )
  );
}

export function workflowConnectionToEdge(
  workflow: WorkflowDefinition,
  connection: WorkflowConnection,
  options: EdgeBuildOptions = {}
): WorkflowEdge {
  const normalized = normalizeWorkflowConnection(connection);
  const sourceHandle = normalizeConnectionHandle(normalized.sourceHandle, "outputs");
  const targetHandle = normalizeConnectionHandle(normalized.targetHandle, "inputs");
  const id = createConnectionId(normalized.source, sourceHandle, normalized.target, targetHandle);
  const sourceNode = workflow.nodes.find((node) => node.id === normalized.source);
  const targetNode = workflow.nodes.find((node) => node.id === normalized.target);

  return {
    id,
    type: "workflow",
    source: normalized.source,
    target: normalized.target,
    sourceHandle,
    targetHandle,
    animated: options.nodeRunsByNodeId?.get(normalized.target)?.status === "running",
    style: { stroke: "#64748b", strokeWidth: 1.7 },
    data: {
      sourceLabel: getPortLabel(sourceNode, "outputs", sourceHandle),
      targetLabel: getPortLabel(targetNode, "inputs", targetHandle),
      sourceHandle,
      targetHandle,
      onDeleteEdge: options.onDeleteEdge,
      onInsertEdge: options.onInsertEdge
    }
  };
}

export function reactFlowConnectionToWorkflowConnection(
  connection: Connection,
  workflow: WorkflowDefinition
): ConnectionResult {
  if (!connection.source || !connection.target) {
    return { error: "Connection requires a source and target node." };
  }

  if (connection.source === connection.target) {
    return { error: "A node cannot connect to itself." };
  }

  const sourceNode = workflow.nodes.find((node) => node.id === connection.source);
  const targetNode = workflow.nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode) {
    return { error: "Connection references a node that no longer exists." };
  }

  const sourceHandle = normalizeConnectionHandle(connection.sourceHandle, "outputs");
  const targetHandle = normalizeConnectionHandle(connection.targetHandle, "inputs");
  const sourcePorts = getNodePorts(sourceNode).outputs;
  const targetPorts = getNodePorts(targetNode).inputs;
  if (!sourcePorts.some((port) => port.handle === sourceHandle)) {
    return { error: `${sourceNode.name} does not expose output port ${sourceHandle}.` };
  }
  if (!targetPorts.some((port) => port.handle === targetHandle)) {
    return { error: `${targetNode.name} does not expose input port ${targetHandle}.` };
  }

  return {
    connection: {
      id: createConnectionId(connection.source, sourceHandle, connection.target, targetHandle),
      source: connection.source,
      target: connection.target,
      sourceHandle,
      targetHandle
    }
  };
}

export function edgeToWorkflowConnection(edge: Edge): WorkflowConnection {
  const sourceHandle = normalizeConnectionHandle(edge.sourceHandle, "outputs");
  const targetHandle = normalizeConnectionHandle(edge.targetHandle, "inputs");
  return {
    id: createConnectionId(edge.source, sourceHandle, edge.target, targetHandle),
    source: edge.source,
    target: edge.target,
    sourceHandle,
    targetHandle
  };
}

function getPortLabel(
  node: WorkflowNode | undefined,
  mode: "inputs" | "outputs",
  handle: StandardWorkflowConnectionHandle
): string {
  const port = node ? getNodePorts(node)[mode].find((candidate) => candidate.handle === handle) : undefined;
  return port?.label ?? handle;
}
