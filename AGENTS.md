# AGENTS.md

## Project overview

Enterprise Agent Workflow Studio — a local TypeScript monorepo for an AI Agent workflow platform. React + Vite frontend, Express + SQLite backend, pnpm workspaces. MVP runs a fixed code-review workflow with mock agents, Markdown artifacts, human approval, and a final review report.

## Setup

```powershell
corepack prepare pnpm@9.15.4 --activate
corepack pnpm install
```

## Dev commands

| Command | What it does |
|---|---|
| `corepack pnpm dev` | Runs API (port 4000) and web (port 5173) in parallel |
| `corepack pnpm dev:api` | API only |
| `corepack pnpm dev:web` | Web only |
| `corepack pnpm typecheck` | Recursive `tsc --noEmit` across all packages |
| `corepack pnpm test` | Recursive `vitest run` across all packages |
| `corepack pnpm build` | Recursive `tsc --noEmit` (same as typecheck) |

Always prefix commands with `corepack pnpm`, not bare `pnpm`. The local npm shim may be broken; this project relies on Corepack.

## Monorepo layout

```text
apps/api/           Express API + orchestrator + SQLite + WebSocket
apps/web/           React + Vite + @xyflow/react canvas
packages/shared/    All shared TypeScript types (single barrel export)
packages/workflow-core/  YAML parsing, validation, topological sort
packages/agent-core/     Agent provider abstraction + mock provider
workflows/          YAML workflow templates (code-review.yaml)
prompts/            Agent system prompt markdown files
data/               Runtime: SQLite DB, artifacts, logs (gitignored)
vendor/D_RD/        Separate git repo — CLI core (gitignored by app repo)
```

## Architecture notes

- **Entry points**: API starts at `apps/api/src/server.ts`. Web starts at `apps/web/src/main.tsx`.
- **Packages export raw TS** via `"exports": { ".": "./src/index.ts" }` — no build step for internal packages.
- **No eslint, prettier, or formatter config** exists. No CI workflows. `typecheck` is the primary code quality gate.
- **Only `workflow-core` has tests** (`packages/workflow-core/test/`). Other packages use `--passWithNoTests`.
- **SQLite** uses Node 22 built-in `node:sqlite` (`DatabaseSync`), not a third-party driver. Schema is created in `db.ts` `initialize()`.
- **`.env` loading is custom** — `apps/api/src/config.ts` manually parses `.env`; no dotenv library.
- **Vite proxies** `/api` → `http://127.0.0.1:4000` and `/ws` → `ws://127.0.0.1:4000`. The API port is configurable via `API_PORT` env var.
- **Workflow execution** is async via `queueMicrotask` in the orchestrator. Runs are non-blocking; status is pushed via WebSocket.
- **Agent provider** is selected by `AGENT_PROVIDER` env var. Only `mock` works; `openai_responses` throws a scaffold error.
- **Artifacts** are file-backed Markdown stored under `data/artifacts/`. SQLite tracks metadata only.

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
# or if safe-directory warning:
git -c safe.directory="$PWD/vendor/D_RD" -C vendor/D_RD pull --ff-only
```

## Workflow YAML schema

Valid node types: `input`, `agent`, `approval`, `output`, `report`. Every workflow must have at least one `input` and one `output`/`report` node. Dependencies are validated and topologically sorted; cycles are rejected.

## Conventions

- ESM only (`"type": "module"` everywhere).
- TypeScript strict mode, target ES2022, bundler module resolution.
- Monorepo package names: `@agent-studio/*`.
- All IDs are `crypto.randomUUID()`.
- `data/` directory is gitignored — it's runtime state, not source.
