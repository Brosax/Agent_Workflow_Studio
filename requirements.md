# Requirements

This repository is a pnpm workspace. The current demo is driven entirely by the dependencies declared in each `package.json`, plus Node.js built-ins such as `node:sqlite`.

## System Requirements

- Node.js 22 or newer
- Corepack enabled
- `pnpm@9.15.4` through Corepack
- Git
- Bun only if you work inside `vendor/D_RD`

## Workspace Dependencies

### Root

Tooling dependencies used by the workspace root:

- `@types/node`
- `typescript`
- `vitest`

### `apps/api`

Runtime dependencies:

- `@agent-studio/agent-core` (`workspace:*`)
- `@agent-studio/shared` (`workspace:*`)
- `@agent-studio/workflow-core` (`workspace:*`)
- `cors`
- `express`
- `tsx`
- `ws`

Development dependencies:

- `@types/cors`
- `@types/express`
- `@types/ws`
- `typescript`
- `vitest`

### `apps/web`

Runtime dependencies:

- `@agent-studio/shared` (`workspace:*`)
- `@vitejs/plugin-react`
- `@xyflow/react`
- `lucide-react`
- `react`
- `react-dom`
- `react-markdown`
- `vite`

Development dependencies:

- `@types/react`
- `@types/react-dom`
- `typescript`
- `vitest`

### `packages/shared`

Development dependencies:

- `typescript`
- `vitest`

### `packages/workflow-core`

Runtime dependencies:

- `@agent-studio/shared` (`workspace:*`)
- `yaml`

Development dependencies:

- `typescript`
- `vitest`

### `packages/agent-core`

Runtime dependencies:

- `@agent-studio/shared` (`workspace:*`)

Development dependencies:

- `typescript`
- `vitest`

## Notes

- The API uses Node's built-in `node:sqlite`, so no third-party SQLite driver is needed.
- `vendor/D_RD` is a separate git repository, not an npm package dependency.
