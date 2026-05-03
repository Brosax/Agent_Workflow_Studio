import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function findWorkspaceRoot(): string {
  let cursor = currentDir;

  while (cursor !== path.dirname(cursor)) {
    if (existsSync(path.join(cursor, "workflows", "code-review.yaml"))) {
      return cursor;
    }
    cursor = path.dirname(cursor);
  }

  return process.cwd();
}

export const workspaceRoot = findWorkspaceRoot();
loadDotEnv(path.join(workspaceRoot, ".env"));
export const apiPort = Number(process.env.API_PORT ?? 4000);
export const dataDir = path.join(workspaceRoot, "data");
export const artifactRoot = path.join(dataDir, "artifacts");
export const databasePath = path.join(dataDir, "studio.sqlite");
export const workflowsDir = path.join(workspaceRoot, "workflows");
export const cliCorePath = path.isAbsolute(process.env.CLI_CORE_PATH ?? "")
  ? String(process.env.CLI_CORE_PATH)
  : path.join(workspaceRoot, process.env.CLI_CORE_PATH ?? "vendor/D_RD");

export async function ensureRuntimeDirs(): Promise<void> {
  await mkdir(artifactRoot, { recursive: true });
}

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
