# Enterprise Agent Workflow Studio

A local TypeScript demo for an internal AI Agent workflow platform. The MVP runs a fixed code-review workflow with mock agents, Markdown artifacts, human approval, and a final review report.

## What Is Implemented

- React workbench with a workflow canvas, workflow editing, run status, artifact viewer, timeline, and approval controls.
- Express API with a local orchestrator, WebSocket run events, SQLite metadata, and file-backed Markdown artifacts.
- YAML workflow template for a code-review pipeline.
- Mock agent provider for deterministic, zero-token local demos.
- Bottom D_RD terminal dock backed by a direct WebSocket-to-CLI process connection.
- Provider abstraction placeholder for future OpenAI Responses API support.

## Prerequisites

- Node.js 22+
- Corepack
- Git
- Bun 1.2+ if you want to build and run the bundled D_RD CLI core

The local `npm` shim on this machine may be broken, so this project uses `pnpm` through Corepack.

## Setup

If you cloned the repository without submodules, initialize the D_RD CLI core first:

```powershell
git submodule update --init --recursive
```

Then install the Studio workspace dependencies:

```powershell
corepack prepare pnpm@9.15.4 --activate
corepack pnpm install
```

To enable the bottom D_RD terminal, build the submodule CLI:

```powershell
cd vendor/D_RD
bun install
bun run build
cd ../..
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

This is a local single-user demo. It does not connect to GitHub/GitLab, publish PR comments, or implement login/RBAC/SSO. The D_RD terminal is local-only and depends on `vendor/D_RD/dist/cli-node.js` being built.

## CLI Core Repository

The lower-level CLI core is tracked as a Git submodule at:

```text
vendor/D_RD
```

Clone or restore it with:

```powershell
git submodule update --init --recursive
```

Update it with:

```powershell
git submodule update --remote --merge vendor/D_RD
```

If Git reports a safe-directory warning from the Codex sandbox user, use:

```powershell
git -c safe.directory="$PWD/vendor/D_RD" -C vendor/D_RD pull --ff-only
```
