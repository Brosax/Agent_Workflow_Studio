import type { WorkflowConnection, WorkflowDefinition, WorkflowNode } from "@agent-studio/shared";

export type WorkflowLayoutKind = "horizontal" | "vertical" | "grid" | "compact-horizontal" | "compact-vertical";

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface NodeAlignmentGuide {
  vertical?: number;
  horizontal?: number;
}

export interface NodeAlignmentSnap {
  position: CanvasPosition;
  guide: NodeAlignmentGuide;
}

export const WORKFLOW_NODE_SIZE = { width: 248, height: 132 };
export const WORKFLOW_LAYOUT_GAP = { x: 340, y: 170 };
export const WORKFLOW_COMPACT_LAYOUT_GAP = { x: 280, y: 132 };
export const WORKFLOW_GRID_GAP = { x: 300, y: 170 };
export const WORKFLOW_COLLISION_GAP = 24;
export const WORKFLOW_SNAP_THRESHOLD = 8;
export const WORKFLOW_SNAP_GRID: [number, number] = [12, 12];

type NodeLike = Pick<WorkflowNode, "id" | "depends_on">;

interface Graph {
  edges: WorkflowConnection[];
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

export function getWorkflowLayoutPositions(
  workflow: WorkflowDefinition,
  kind: WorkflowLayoutKind
): Map<string, CanvasPosition> {
  const nodes = workflow.nodes;
  if (nodes.length === 0) {
    return new Map();
  }

  if (kind === "grid") {
    return resolveAllCollisions(getGridPositions(nodes));
  }

  const compact = kind.startsWith("compact");
  const vertical = kind === "vertical" || kind === "compact-vertical";
  const gap = compact ? WORKFLOW_COMPACT_LAYOUT_GAP : WORKFLOW_LAYOUT_GAP;
  const graph = buildGraph(workflow);
  const components = getComponents(nodes, graph);
  const positions = new Map<string, CanvasPosition>();
  let componentOffset = 0;

  for (const component of components) {
    const layers = getComponentLayers(component, graph);
    const componentPositions = vertical
      ? getVerticalLayerPositions(layers, gap, componentOffset)
      : getHorizontalLayerPositions(layers, gap, componentOffset);
    for (const [nodeId, position] of componentPositions) {
      positions.set(nodeId, position);
    }

    const bounds = getBounds([...componentPositions.values()]);
    componentOffset += vertical
      ? bounds.width + gap.x
      : bounds.height + gap.y;
  }

  return resolveAllCollisions(positions);
}

export function resolveAllCollisions(
  initialPositions: Map<string, CanvasPosition>,
  nodeIds: string[] = [...initialPositions.keys()]
): Map<string, CanvasPosition> {
  const resolved = new Map<string, CanvasPosition>();
  for (const nodeId of nodeIds) {
    const current = initialPositions.get(nodeId);
    if (!current) {
      continue;
    }
    resolved.set(nodeId, resolveNodeCollision(nodeId, current, resolved));
  }
  return resolved;
}

export function resolveNodeCollision(
  nodeId: string,
  position: CanvasPosition,
  otherPositions: Map<string, CanvasPosition>
): CanvasPosition {
  if (!hasCollision(nodeId, position, otherPositions)) {
    return position;
  }

  const stepX = WORKFLOW_NODE_SIZE.width + WORKFLOW_COLLISION_GAP;
  const stepY = WORKFLOW_NODE_SIZE.height + WORKFLOW_COLLISION_GAP;
  const candidates: CanvasPosition[] = [];
  for (let ring = 1; ring <= 16; ring += 1) {
    candidates.push(
      { x: position.x + stepX * ring, y: position.y },
      { x: position.x, y: position.y + stepY * ring },
      { x: position.x - stepX * ring, y: position.y },
      { x: position.x, y: position.y - stepY * ring },
      { x: position.x + stepX * ring, y: position.y + stepY * ring },
      { x: position.x - stepX * ring, y: position.y + stepY * ring }
    );
  }

  const nearest = candidates
    .filter((candidate) => candidate.x >= 0 && candidate.y >= 0)
    .filter((candidate) => !hasCollision(nodeId, candidate, otherPositions))
    .sort((a, b) => distanceSquared(position, a) - distanceSquared(position, b))[0];

  return nearest ?? position;
}

export function findNodeAlignmentSnap(
  nodeId: string,
  position: CanvasPosition,
  otherPositions: Map<string, CanvasPosition>,
  threshold = WORKFLOW_SNAP_THRESHOLD
): NodeAlignmentSnap {
  const activeAnchors = getAnchors(position);
  let bestX: { delta: number; guide: number } | undefined;
  let bestY: { delta: number; guide: number } | undefined;

  for (const [otherId, otherPosition] of otherPositions) {
    if (otherId === nodeId) {
      continue;
    }
    const otherAnchors = getAnchors(otherPosition);
    for (const activeX of activeAnchors.x) {
      for (const otherX of otherAnchors.x) {
        const delta = otherX - activeX;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, guide: otherX };
        }
      }
    }
    for (const activeY of activeAnchors.y) {
      for (const otherY of otherAnchors.y) {
        const delta = otherY - activeY;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, guide: otherY };
        }
      }
    }
  }

  return {
    position: {
      x: Math.max(0, position.x + (bestX?.delta ?? 0)),
      y: Math.max(0, position.y + (bestY?.delta ?? 0))
    },
    guide: {
      vertical: bestX?.guide,
      horizontal: bestY?.guide
    }
  };
}

export function hasAnyNodeOverlap(positions: Map<string, CanvasPosition>): boolean {
  const entries = [...positions.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (rectsOverlap(entries[i][1], entries[j][1], 0)) {
        return true;
      }
    }
  }
  return false;
}

function buildGraph(workflow: WorkflowDefinition): Graph {
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const edges = workflow.connections?.length
    ? workflow.connections
    : workflow.nodes.flatMap((node) =>
        (node.depends_on ?? []).map((dependency) => ({
          id: `${dependency}-${node.id}`,
          source: dependency,
          target: node.id
        }))
      );
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  return { edges, outgoing, incoming };
}

function getComponents(nodes: NodeLike[], graph: Graph): string[][] {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const neighbors = [...(graph.outgoing.get(current) ?? []), ...(graph.incoming.get(current) ?? [])];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    component.sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));
    components.push(component);
  }

  return components.sort((a, b) => (indexById.get(a[0]) ?? 0) - (indexById.get(b[0]) ?? 0));
}

function getComponentLayers(component: string[], graph: Graph): string[][] {
  const componentSet = new Set(component);
  const indegree = new Map(component.map((nodeId) => [nodeId, 0]));
  const layer = new Map(component.map((nodeId) => [nodeId, 0]));
  const indexById = new Map(component.map((nodeId, index) => [nodeId, index]));

  for (const nodeId of component) {
    for (const target of graph.outgoing.get(nodeId) ?? []) {
      if (componentSet.has(target)) {
        indegree.set(target, (indegree.get(target) ?? 0) + 1);
      }
    }
  }

  const queue = component.filter((nodeId) => indegree.get(nodeId) === 0);
  const visited: string[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));
    const current = queue.shift()!;
    visited.push(current);
    for (const target of graph.outgoing.get(current) ?? []) {
      if (!componentSet.has(target)) {
        continue;
      }
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(current) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if (indegree.get(target) === 0) {
        queue.push(target);
      }
    }
  }

  if (visited.length !== component.length) {
    return component.map((nodeId) => [nodeId]);
  }

  const layers: string[][] = [];
  for (const nodeId of component) {
    const layerIndex = layer.get(nodeId) ?? 0;
    layers[layerIndex] = layers[layerIndex] ?? [];
    layers[layerIndex].push(nodeId);
  }

  return layers.map((nodes) => nodes.sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0)));
}

function getHorizontalLayerPositions(
  layers: string[][],
  gap: typeof WORKFLOW_LAYOUT_GAP,
  yOffset: number
): Map<string, CanvasPosition> {
  const positions = new Map<string, CanvasPosition>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    layers[layerIndex].forEach((nodeId, rowIndex) => {
      positions.set(nodeId, {
        x: 120 + layerIndex * gap.x,
        y: 120 + yOffset + rowIndex * gap.y
      });
    });
  }
  return positions;
}

function getVerticalLayerPositions(
  layers: string[][],
  gap: typeof WORKFLOW_LAYOUT_GAP,
  xOffset: number
): Map<string, CanvasPosition> {
  const positions = new Map<string, CanvasPosition>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    layers[layerIndex].forEach((nodeId, columnIndex) => {
      positions.set(nodeId, {
        x: 120 + xOffset + columnIndex * gap.x,
        y: 120 + layerIndex * gap.y
      });
    });
  }
  return positions;
}

function getGridPositions(nodes: NodeLike[]): Map<string, CanvasPosition> {
  const positions = new Map<string, CanvasPosition>();
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  nodes.forEach((node, index) => {
    positions.set(node.id, {
      x: 120 + (index % columns) * WORKFLOW_GRID_GAP.x,
      y: 120 + Math.floor(index / columns) * WORKFLOW_GRID_GAP.y
    });
  });
  return positions;
}

function hasCollision(
  nodeId: string,
  position: CanvasPosition,
  otherPositions: Map<string, CanvasPosition>
): boolean {
  for (const [otherId, otherPosition] of otherPositions) {
    if (otherId !== nodeId && rectsOverlap(position, otherPosition, WORKFLOW_COLLISION_GAP)) {
      return true;
    }
  }
  return false;
}

function rectsOverlap(a: CanvasPosition, b: CanvasPosition, gap: number): boolean {
  return !(
    a.x + WORKFLOW_NODE_SIZE.width + gap <= b.x ||
    b.x + WORKFLOW_NODE_SIZE.width + gap <= a.x ||
    a.y + WORKFLOW_NODE_SIZE.height + gap <= b.y ||
    b.y + WORKFLOW_NODE_SIZE.height + gap <= a.y
  );
}

function getBounds(positions: CanvasPosition[]): { width: number; height: number } {
  if (positions.length === 0) {
    return { width: 0, height: 0 };
  }
  const minX = Math.min(...positions.map((position) => position.x));
  const maxX = Math.max(...positions.map((position) => position.x + WORKFLOW_NODE_SIZE.width));
  const minY = Math.min(...positions.map((position) => position.y));
  const maxY = Math.max(...positions.map((position) => position.y + WORKFLOW_NODE_SIZE.height));
  return { width: maxX - minX, height: maxY - minY };
}

function getAnchors(position: CanvasPosition): { x: number[]; y: number[] } {
  return {
    x: [position.x, position.x + WORKFLOW_NODE_SIZE.width / 2, position.x + WORKFLOW_NODE_SIZE.width],
    y: [position.y, position.y + WORKFLOW_NODE_SIZE.height / 2, position.y + WORKFLOW_NODE_SIZE.height]
  };
}

function distanceSquared(a: CanvasPosition, b: CanvasPosition): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
