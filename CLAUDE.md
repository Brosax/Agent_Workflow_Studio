# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Enterprise Agent Workflow Studio — a local TypeScript monorepo for an AI Agent workflow platform. React + Vite frontend, Express + SQLite backend, pnpm workspaces. MVP runs a fixed code-review workflow with mock agents, Markdown artifacts, human approval, and a final review report.

## Commands

Always use `corepack pnpm`, not bare `pnpm` (the local npm shim may be broken).

| Command | What it does |
|---|---|
| `corepack pnpm dev` | Runs API (port 4000) and web (port 5173) in parallel |
| `corepack pnpm dev:api` | API only |
| `corepack pnpm dev:web` | Web only |
| `corepack pnpm typecheck` | Recursive `tsc --noEmit` across all packages |
| `corepack pnpm test` | Recursive `vitest run` across all packages |
| `corepack pnpm build` | Recursive `tsc --noEmit` (same as typecheck) |

To run a single test file: `corepack pnpm vitest run <path>` (e.g., `corepack pnpm vitest run packages/workflow-core/test/workflow-core.test.ts`).

## Monorepo layout

```text
apps/api/              Express API + orchestrator + SQLite + WebSocket
apps/web/              React + Vite + @xyflow/react canvas
packages/shared/       All shared TypeScript types (single barrel export)
packages/workflow-core/  YAML parsing, validation, topological sort
packages/agent-core/   Agent provider abstraction + mock provider
workflows/             YAML workflow templates (code-review.yaml)
prompts/               Agent system prompt markdown files
data/                  Runtime: SQLite DB, artifacts, logs (gitignored)
vendor/D_RD/           Separate git repo — CLI core (gitignored by app repo)
```

## Architecture

- **Entry points**: API at `apps/api/src/server.ts`, web at `apps/web/src/main.tsx`.
- **Packages export raw TS** via `"exports": { ".": "./src/index.ts" }` — no build step for internal packages.
- **SQLite** uses Node 22 built-in `node:sqlite` (`DatabaseSync`), not a third-party driver. Schema is created in `db.ts` `initialize()`.
- **`.env` loading is custom** — `apps/api/src/config.ts` manually parses `.env`; no dotenv library.
- **Vite proxies** `/api` → `http://127.0.0.1:4000` and `/ws` → `ws://127.0.0.1:4000`. API port configurable via `API_PORT` env var.
- **Workflow execution** is async via `queueMicrotask` in the orchestrator. Runs are non-blocking; status is pushed via WebSocket (`/ws/runs/:runId`).
- **Agent provider** selected by `AGENT_PROVIDER` env var. Only `mock` works; `openai_responses` throws a scaffold error.
- **Artifacts** are file-backed Markdown stored under `data/artifacts/`. SQLite tracks metadata only.
- **Workflow YAML** schema: valid node types are `input`, `agent`, `approval`, `output`, `report`, `trigger`, `model_selector`, `tool_executor`, `document_loader`, `retriever`, `condition`, `merge`, `filter`. Every workflow needs at least one `input`/`trigger` and one `output`/`report` node. Dependencies are validated and topologically sorted; cycles are rejected.
- **Connection handles** use a `mode/type/index` format (e.g., `outputs/main/0`). Legacy handles (`main`, `true`, `false`) are normalized automatically.
- **No eslint, prettier, or formatter config** exists. `typecheck` is the primary code quality gate.
- Only `workflow-core` has tests (`packages/workflow-core/test/`). Other packages use `--passWithNoTests`.

## Conventions

- ESM only (`"type": "module"` everywhere).
- TypeScript strict mode, target ES2022, bundler module resolution.
- Monorepo package names: `@agent-studio/*`.
- All IDs are `crypto.randomUUID()`.
- `data/` directory is gitignored — it's runtime state, not source.

## Key env vars (`.env`)

```text
API_PORT=4000
WEB_PORT=5173
AGENT_PROVIDER=mock          # only "mock" works currently
OPENAI_API_KEY=              # placeholder for future
OPENAI_MODEL=gpt-4.1         # placeholder for future
CLI_CORE_PATH=vendor/D_RD
```

## Vendor: CLI core

`vendor/D_RD/` is a separate git repo, ignored by this app. Update with:

```powershell
git -C vendor/D_RD pull --ff-only
```
