import { describe, expect, it } from "vitest";
import {
  parseWorkflowDefinition,
  topologicalSortNodes,
  validateWorkflowDefinition,
  connectionsToDependsOn
} from "../src/index";
import type { WorkflowConnection, WorkflowDefinition, WorkflowNode } from "@agent-studio/shared";

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

  it("accepts trigger as an input-equivalent node", () => {
    expect(() =>
      validateWorkflowDefinition({
        id: "trigger-workflow",
        name: "Trigger Workflow",
        description: "Uses trigger instead of input",
        version: 1,
        inputs: {},
        nodes: [
          { id: "trigger", type: "trigger", name: "Trigger" },
          { id: "output", type: "output", name: "Output", depends_on: ["trigger"] }
        ]
      })
    ).not.toThrow();
  });

  it("validates all new MVP node types", () => {
    const workflow: WorkflowDefinition = {
      id: "mvp-types",
      name: "MVP Types",
      description: "Test all new node types",
      version: 1,
      inputs: {},
      nodes: [
        { id: "trigger", type: "trigger", name: "Trigger" },
        { id: "model", type: "model_selector", name: "Model", depends_on: ["trigger"] },
        { id: "tool", type: "tool_executor", name: "Tool", depends_on: ["trigger"] },
        { id: "loader", type: "document_loader", name: "Loader", depends_on: ["trigger"] },
        { id: "retriever", type: "retriever", name: "Retriever", depends_on: ["loader"] },
        { id: "condition", type: "condition", name: "Condition", depends_on: ["trigger"] },
        { id: "merge", type: "merge", name: "Merge", depends_on: ["condition"] },
        { id: "filter", type: "filter", name: "Filter", depends_on: ["merge"] },
        { id: "output", type: "output", name: "Output", depends_on: ["filter"] }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).not.toThrow();
  });
});

describe("connections", () => {
  it("validates workflows with connections", () => {
    const workflow: WorkflowDefinition = {
      id: "conn-workflow",
      name: "Connection Workflow",
      description: "Uses connections",
      version: 1,
      inputs: {},
      nodes: [
        { id: "input", type: "input", name: "Input" },
        { id: "agent", type: "agent", name: "Agent" },
        { id: "output", type: "output", name: "Output" }
      ],
      connections: [
        { id: "c1", source: "input", target: "agent", sourceHandle: "main" },
        { id: "c2", source: "agent", target: "output", sourceHandle: "main" }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).not.toThrow();
  });

  it("rejects connections with missing source node", () => {
    const workflow: WorkflowDefinition = {
      id: "bad-conn",
      name: "Bad Connection",
      description: "Missing source",
      version: 1,
      inputs: {},
      nodes: [
        { id: "input", type: "input", name: "Input" },
        { id: "output", type: "output", name: "Output" }
      ],
      connections: [
        { id: "c1", source: "missing", target: "output", sourceHandle: "main" }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).toThrow(/missing source node/);
  });

  it("rejects connections with missing target node", () => {
    const workflow: WorkflowDefinition = {
      id: "bad-conn",
      name: "Bad Connection",
      description: "Missing target",
      version: 1,
      inputs: {},
      nodes: [
        { id: "input", type: "input", name: "Input" },
        { id: "output", type: "output", name: "Output" }
      ],
      connections: [
        { id: "c1", source: "input", target: "missing", sourceHandle: "main" }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).toThrow(/missing target node/);
  });

  it("rejects self-loop connections", () => {
    const workflow: WorkflowDefinition = {
      id: "self-loop",
      name: "Self Loop",
      description: "Self loop",
      version: 1,
      inputs: {},
      nodes: [
        { id: "input", type: "input", name: "Input" },
        { id: "output", type: "output", name: "Output" }
      ],
      connections: [
        { id: "c1", source: "input", target: "input", sourceHandle: "main" }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).toThrow(/self-loop/);
  });

  it("rejects condition connections without true/false handle", () => {
    const workflow: WorkflowDefinition = {
      id: "cond-bad-handle",
      name: "Condition Bad Handle",
      description: "Condition without handle",
      version: 1,
      inputs: {},
      nodes: [
        { id: "input", type: "input", name: "Input" },
        { id: "cond", type: "condition", name: "Condition", depends_on: ["input"] },
        { id: "output", type: "output", name: "Output" }
      ],
      connections: [
        { id: "c1", source: "input", target: "cond" },
        { id: "c2", source: "cond", target: "output", sourceHandle: "main" }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).toThrow(/sourceHandle "true" or "false"/);
  });

  it("accepts condition connections with true/false handles", () => {
    const workflow: WorkflowDefinition = {
      id: "cond-good",
      name: "Condition Good",
      description: "Condition with handles",
      version: 1,
      inputs: {},
      nodes: [
        { id: "input", type: "input", name: "Input" },
        { id: "cond", type: "condition", name: "Condition", depends_on: ["input"] },
        { id: "agent_a", type: "agent", name: "Agent A" },
        { id: "agent_b", type: "agent", name: "Agent B" },
        { id: "output", type: "output", name: "Output" }
      ],
      connections: [
        { id: "c1", source: "input", target: "cond" },
        { id: "c2", source: "cond", target: "agent_a", sourceHandle: "true" },
        { id: "c3", source: "cond", target: "agent_b", sourceHandle: "false" },
        { id: "c4", source: "agent_a", target: "output" },
        { id: "c5", source: "agent_b", target: "output" }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).not.toThrow();
  });

  it("converts connections to depends_on", () => {
    const nodes: WorkflowNode[] = [
      { id: "input", type: "input", name: "Input" },
      { id: "agent", type: "agent", name: "Agent" },
      { id: "output", type: "output", name: "Output" }
    ];
    const connections: WorkflowConnection[] = [
      { id: "c1", source: "input", target: "agent", sourceHandle: "main" },
      { id: "c2", source: "agent", target: "output", sourceHandle: "main" }
    ];

    const result = connectionsToDependsOn(nodes, connections);
    expect(result[0].depends_on).toEqual([]);
    expect(result[1].depends_on).toEqual(["input"]);
    expect(result[2].depends_on).toEqual(["agent"]);
  });

  it("rejects invalid sourceHandle values", () => {
    const workflow: WorkflowDefinition = {
      id: "bad-handle-val",
      name: "Bad Handle Value",
      description: "Invalid handle value",
      version: 1,
      inputs: {},
      nodes: [
        { id: "input", type: "input", name: "Input" },
        { id: "output", type: "output", name: "Output" }
      ],
      connections: [
        { id: "c1", source: "input", target: "output", sourceHandle: "invalid_handle" as "main" }
      ]
    };

    expect(() => validateWorkflowDefinition(workflow)).toThrow(/invalid sourceHandle/);
  });

  it("topological sort works with connections", () => {
    const nodes: WorkflowNode[] = [
      { id: "a", type: "input", name: "A" },
      { id: "b", type: "agent", name: "B" },
      { id: "c", type: "output", name: "C" }
    ];
    const connections: WorkflowConnection[] = [
      { id: "c1", source: "a", target: "b", sourceHandle: "main" },
      { id: "c2", source: "b", target: "c", sourceHandle: "main" }
    ];

    const withDeps = connectionsToDependsOn(nodes, connections);
    expect(topologicalSortNodes(withDeps).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects cycles in connections", () => {
    const nodes: WorkflowNode[] = [
      { id: "a", type: "agent", name: "A" },
      { id: "b", type: "agent", name: "B" }
    ];
    const connections: WorkflowConnection[] = [
      { id: "c1", source: "a", target: "b", sourceHandle: "main" },
      { id: "c2", source: "b", target: "a", sourceHandle: "main" }
    ];

    const withDeps = connectionsToDependsOn(nodes, connections);
    expect(() => topologicalSortNodes(withDeps)).toThrow(/cycle/);
  });
});
