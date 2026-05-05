import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@agent-studio/shared";
import {
  findNodeAlignmentSnap,
  getWorkflowLayoutPositions,
  hasAnyNodeOverlap,
  resolveNodeCollision
} from "./workflowLayout";

describe("workflow layout", () => {
  it("lays out connection-only workflows horizontally without overlap", () => {
    const positions = getWorkflowLayoutPositions(buildBranchWorkflow(), "horizontal");

    expect(positions.get("input")?.x).toBeLessThan(positions.get("condition")?.x ?? 0);
    expect(positions.get("condition")?.x).toBeLessThan(positions.get("merge")?.x ?? 0);
    expect(hasAnyNodeOverlap(positions)).toBe(false);
  });

  it("lays out workflows vertically without overlap", () => {
    const positions = getWorkflowLayoutPositions(buildBranchWorkflow(), "vertical");

    expect(positions.get("input")?.y).toBeLessThan(positions.get("condition")?.y ?? 0);
    expect(positions.get("condition")?.y).toBeLessThan(positions.get("merge")?.y ?? 0);
    expect(hasAnyNodeOverlap(positions)).toBe(false);
  });

  it("separates condition branches in the same layer", () => {
    const positions = getWorkflowLayoutPositions(buildBranchWorkflow(), "horizontal");

    expect(positions.get("true_tool")?.x).toBe(positions.get("false_filter")?.x);
    expect(positions.get("true_tool")?.y).not.toBe(positions.get("false_filter")?.y);
  });

  it("places disconnected nodes outside the main component", () => {
    const workflow = buildBranchWorkflow();
    workflow.nodes.push({ id: "note", type: "agent", name: "Detached" });
    const positions = getWorkflowLayoutPositions(workflow, "horizontal");

    expect(positions.get("note")?.y).toBeGreaterThan(positions.get("input")?.y ?? 0);
    expect(hasAnyNodeOverlap(positions)).toBe(false);
  });

  it("creates deterministic grid and compact layouts", () => {
    const grid = getWorkflowLayoutPositions(buildBranchWorkflow(), "grid");
    const compact = getWorkflowLayoutPositions(buildBranchWorkflow(), "compact-horizontal");

    expect(grid.get("input")).toEqual({ x: 120, y: 120 });
    expect(compact.get("condition")?.x).toBe(400);
    expect(hasAnyNodeOverlap(grid)).toBe(false);
    expect(hasAnyNodeOverlap(compact)).toBe(false);
  });

  it("moves a colliding node to the nearest empty slot", () => {
    const otherPositions = new Map([
      ["a", { x: 120, y: 120 }],
      ["b", { x: 392, y: 120 }]
    ]);

    const resolved = resolveNodeCollision("c", { x: 120, y: 120 }, otherPositions);

    expect(resolved).not.toEqual({ x: 120, y: 120 });
    expect(hasAnyNodeOverlap(new Map([...otherPositions, ["c", resolved]]))).toBe(false);
  });

  it("snaps dragged nodes to nearby node anchors", () => {
    const snap = findNodeAlignmentSnap(
      "b",
      { x: 366, y: 118 },
      new Map([["a", { x: 120, y: 120 }]])
    );

    expect(snap.position.x).toBe(368);
    expect(snap.position.y).toBe(120);
    expect(snap.guide.vertical).toBe(368);
    expect(snap.guide.horizontal).toBe(120);
  });
});

function buildBranchWorkflow(): WorkflowDefinition {
  return {
    id: "layout-test",
    name: "Layout Test",
    description: "Layout test workflow",
    version: 1,
    inputs: {},
    nodes: [
      { id: "input", type: "input", name: "Input" },
      { id: "condition", type: "condition", name: "Condition" },
      { id: "true_tool", type: "tool_executor", name: "True Tool" },
      { id: "false_filter", type: "filter", name: "False Filter" },
      { id: "merge", type: "merge", name: "Merge" },
      { id: "output", type: "output", name: "Output" }
    ],
    connections: [
      { id: "c1", source: "input", target: "condition" },
      { id: "c2", source: "condition", target: "true_tool", sourceHandle: "outputs/main/0" },
      { id: "c3", source: "condition", target: "false_filter", sourceHandle: "outputs/main/1" },
      { id: "c4", source: "true_tool", target: "merge" },
      { id: "c5", source: "false_filter", target: "merge" },
      { id: "c6", source: "merge", target: "output" }
    ]
  };
}
