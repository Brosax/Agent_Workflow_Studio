# Enterprise Agent Workflow Studio

A local TypeScript demo for an internal AI Agent workflow platform. The MVP runs a fixed code-review workflow with mock agents, Markdown artifacts, human approval, and a final review report.

## What Is Implemented

- React workbench with a workflow canvas, run status, artifact viewer, timeline, and approval controls.
- Express API with a local orchestrator, WebSocket run events, SQLite metadata, and file-backed Markdown artifacts.
- YAML workflow template for a code-review pipeline.
- Mock agent provider for deterministic, zero-token local demos.
- Provider abstraction placeholder for future OpenAI Responses API support.

## Prerequisites

- Node.js 22+
- Corepack

The local `npm` shim on this machine may be broken, so this project uses `pnpm` through Corepack.

## Setup

```powershell
corepack prepare pnpm@9.15.4 --activate
corepack pnpm install
```

## Run

```powershell
corepack pnpm dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000

## Demo Flow

1. Open the web app.
2. Keep the provided fake PR URL and diff, or edit them.
3. Click Run workflow.
4. Watch the nodes progress through mock agent execution.
5. When Human Approval pauses the workflow, approve or reject it.
6. After approval, open the final review report artifact.

## Current Scope

This is a local single-user demo. It does not connect to GitHub/GitLab, call a real LLM, execute shell commands, modify code, publish PR comments, or implement login/RBAC/SSO.

## CLI Core Repository

The lower-level CLI core is cloned as an independent Git repository at:

```text
vendor/D_RD
```

It is ignored by this app repository so it can keep its own `.git` history and be updated separately.

Update it with:

```powershell
git -C vendor/D_RD pull --ff-only
```

If Git reports a safe-directory warning from the Codex sandbox user, use:

```powershell
git -c safe.directory="$PWD/vendor/D_RD" -C vendor/D_RD pull --ff-only
```
