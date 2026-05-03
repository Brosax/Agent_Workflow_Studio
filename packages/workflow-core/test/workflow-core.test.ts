import { describe, expect, it } from "vitest";
import { parseWorkflowDefinition, topologicalSortNodes, validateWorkflowDefinition } from "../src/index";
import type { WorkflowNode } from "@agent-studio/shared";

describe("workflow-core", () => {
  it("sorts nodes by dependency order", () => {
    const nodes: WorkflowNode[] = [
      { id: "b", type: "agent", name: "B", depends_on: ["a"] },
      { id: "a", type: "input", name: "A" },
      { id: "c", type: "approval", name: "C", depends_on: ["b"] }
    ];

    expect(topologicalSortNodes(nodes).map((node) => node.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects dependency cycles", () => {
    const nodes: WorkflowNode[] = [
      { id: "a", type: "agent", name: "A", depends_on: ["b"] },
      { id: "b", type: "agent", name: "B", depends_on: ["a"] }
    ];

    expect(() => topologicalSortNodes(nodes)).toThrow(/cycle/);
  });

  it("parses and validates yaml", () => {
    const workflow = parseWorkflowDefinition(`
id: demo
name: Demo
description: Demo workflow
version: 1
inputs: {}
nodes:
  - id: input
    type: input
    name: Input
  - id: output
    type: output
    name: Output
    depends_on: [input]
`);

    expect(workflow.id).toBe("demo");
    expect(workflow.nodes).toHaveLength(2);
  });

  it("requires an input node and an output node", () => {
    expect(() =>
      validateWorkflowDefinition({
        id: "missing-input",
        name: "Missing Input",
        description: "Invalid workflow",
        version: 1,
        inputs: {},
        nodes: [{ id: "output", type: "output", name: "Output" }]
      })
    ).toThrow(/input/);

    expect(() =>
      validateWorkflowDefinition({
        id: "missing-output",
        name: "Missing Output",
        description: "Invalid workflow",
        version: 1,
        inputs: {},
        nodes: [{ id: "input", type: "input", name: "Input" }]
      })
    ).toThrow(/output/);
  });
});
