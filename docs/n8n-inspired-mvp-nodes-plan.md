# n8n-Inspired MVP Nodes Implementation Plan

## Summary

Implement a small set of runnable MVP nodes inspired by n8n's information architecture. The goal is not to copy n8n's hundreds of integration nodes, but to evolve the current Studio from `input / agent / approval / report / output` into a practical Agent workflow builder.

Default decisions:

- Scope: MVP node set
- Execution depth: runnable semantics
- Integration style: borrow n8n interaction and node taxonomy, do not import n8n source
- Safety: first phase stays local, deterministic, and low-risk; no arbitrary shell or HTTP execution

## Key Changes

### 1. Workflow Types And Connection Model

Extend shared workflow types:

- Keep existing nodes: `input`, `agent`, `approval`, `report`, `output`
- Add MVP nodes:
  - `trigger`
  - `model_selector`
  - `tool_executor`
  - `document_loader`
  - `retriever`
  - `condition`
  - `merge`
  - `filter`

Add `WorkflowConnection`:

```ts
type WorkflowConnectionHandle = "main" | "true" | "false";

interface WorkflowConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: WorkflowConnectionHandle;
  targetHandle?: string;
}
```

Add optional `connections` to `WorkflowDefinition`:

```ts
connections?: WorkflowConnection[];
```

Compatibility rules:

- Existing workflows with only `depends_on` remain runnable.
- Newly saved workflows store both `connections` and derived `depends_on`.
- `workflow-core` prefers `connections` for validation and sorting, and falls back to `depends_on` when absent.
- SQLite does not need a schema migration because workflows are already stored in `definition_json`.

### 2. MVP Node Execution Semantics

Implement a unified node runner dispatch layer instead of growing more scattered `if node.type === ...` branches in the orchestrator.

Node behavior:

- `trigger`
  - MVP supports manual trigger only.
  - Executes immediately and succeeds.
  - The Run button is equivalent to triggering this node.

- `input`
  - Keeps existing file, folder, and text input behavior.
  - Produces an input summary artifact: `input_summary.json`.

- `model_selector`
  - Produces `model_context.json`.
  - Downstream `agent` and `report` nodes inherit the closest upstream model context by default.
  - MVP provider options: `mock`, `codex_cli`, `openai_responses`, `ollama`, `openai_compatible`.
  - Unavailable providers show scaffold/error behavior instead of silently running.

- `tool_executor`
  - MVP supports only safe tools:
    - `d_rd_cli_status`
    - `git_status`
    - `list_input_files`
  - Produces `tool_result.json` or `tool_result.md`.
  - Does not support arbitrary shell commands or arbitrary HTTP requests.

- `document_loader`
  - Reads run input files and upstream artifacts.
  - Produces `documents.json`.
  - Each document includes `id`, `name`, `source`, `content`, and `size`.

- `retriever`
  - Performs simple keyword retrieval over `documents.json` or all artifacts.
  - Default query uses `contextNote`.
  - Default `topK = 5`.
  - Produces `retrieved_context.md` and `retrieved_context.json`.

- `condition`
  - Supports `true` and `false` output handles.
  - MVP expression config is simple and does not run arbitrary JS:
    - source: `context_note`, `optional_diff`, `combined_artifacts`
    - operator: `contains`, `not_contains`, `equals`, `exists`
    - value: string
  - Produces `condition_result.json`.
  - Activates only the matching outgoing branch; the other branch is marked `skipped`.

- `merge`
  - Waits for all active upstream nodes.
  - Ignores inactive/skipped branches.
  - Default strategy: `concat_artifacts`.
  - Produces `merged_context.md`.

- `filter`
  - Filters merged artifact text.
  - MVP supports `contains` and `not_contains`.
  - Produces `filtered_context.md`.

- `agent`, `approval`, `report`, `output`
  - Keep current behavior.
  - `agent` and `report` can read upstream `model_context.json`, retrieved context, and tool results.
  - `approval` continues pausing the workflow.
  - `output` continues aggregating artifacts and generating target formats.

Branch execution rules:

- `condition` activates only the selected `true` or `false` branch.
- A downstream node with no active incoming connection is marked `skipped`.
- A downstream node with active incoming connections waits for all active dependencies to succeed.
- `merge` can combine an active branch and ignore a skipped branch without failing.

### 3. Web UI Updates

Update the node library taxonomy:

```text
Trigger
- Manual Trigger

Input
- File / Folder Input
- Document Loader

Agent
- Model Selector
- Agent
- Report Agent

Tools
- Tool Executor
- Retriever

Control
- If / Condition
- Merge
- Filter
- Human Approval

Output
- Artifact Output
- Markdown Report
```

Canvas behavior:

- `condition` nodes show `true` and `false` source handles.
- Normal nodes show a `main` handle.
- Connection validation supports:
  - Disallow connecting back into trigger/input nodes.
  - Disallow connecting forward from output/report nodes.
  - Disallow cycles.
  - Preserve condition `true`/`false` handle metadata.
- Workflow Outline shows `skipped` status.
- Execution Logs show `node_skipped` events.
- Artifacts tab shows JSON and Markdown artifacts from new nodes.

Right-side NodeEditor:

- Display type-specific configuration panels.
- Add config fields for:
  - trigger mode
  - model provider/model
  - tool kind
  - document source
  - retriever query/topK
  - condition source/operator/value
  - merge strategy
  - filter operator/value
- Show unsupported external tools as disabled rather than hiding them.

### 4. API And Backend Updates

Core files:

- `packages/shared/src/index.ts`
- `packages/workflow-core/src/index.ts`
- `apps/api/src/orchestrator.ts`
- `apps/web/src/App.tsx`

Backend helper functions:

- `getWorkflowConnections(workflow)`
- `getActiveDependencies(node, runContext)`
- `markInactiveBranchSkipped(conditionNode, selectedHandle)`
- `readUpstreamArtifacts(runId, nodeId)`
- `saveJsonArtifact(...)`
- `saveMarkdownArtifact(...)`

Node runner map:

```ts
const NODE_RUNNERS = {
  trigger,
  input,
  model_selector,
  tool_executor,
  document_loader,
  retriever,
  condition,
  merge,
  filter,
  agent,
  approval,
  report,
  output
};
```

Error handling:

- Missing node config marks the node `failed` and the workflow `failed`.
- Invalid condition expression marks the node `failed`.
- Calling an unavailable tool marks the node `failed`.
- Skipped nodes do not create artifacts, but do emit `node_skipped`.

## Test Plan

Automated checks:

- `corepack pnpm typecheck`
- `corepack pnpm test`

`workflow-core` tests:

- Existing `depends_on` workflows still validate and sort.
- `connections` workflows validate and sort.
- Cycles are rejected.
- Condition `true` and `false` handles are preserved.

Orchestrator tests:

- Manual trigger + input + output runs successfully.
- Condition true branch executes and false branch is skipped.
- Condition false branch executes and true branch is skipped.
- Merge ignores inactive branch.
- `document_loader` creates `documents.json`.
- `retriever` creates topK results.
- `tool_executor` can run `git_status` and `list_input_files`.

Web tests:

- Node catalog includes the new categories.
- `createNode` can create every MVP node type.
- Condition nodes save `true` and `false` connections.
- NodeEditor shows the correct config fields for each node type.

Browser acceptance:

- Create a blank workflow.
- Add manual trigger, file input, document loader, retriever, agent, approval, and report nodes.
- Save and refresh; nodes and connections persist.
- Add condition and connect true/false branches.
- Run workflow; one branch succeeds and the other is skipped.
- View Execution Logs and Artifacts.
- Open artifact preview in the right panel.
- Confirm the existing code-review template still runs.

## Assumptions

- First phase does not implement n8n SaaS integration nodes such as Slack, Google, or GitHub API nodes.
- First phase does not execute arbitrary user shell commands.
- First phase does not expose an arbitrary HTTP request node.
- First phase does not implement a complex expression language.
- D_RD is first exposed through `tool_executor: d_rd_cli_status`; full CLI chat/tool invocation is deferred.
- Existing workflow data is upgraded compatibly through JSON, with no SQLite schema migration.
- n8n remains a reference repo only; it is not added as a project dependency and no n8n source is copied.
