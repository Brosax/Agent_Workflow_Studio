import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import type {
  ApprovalRequest,
  CreateAgentRequest,
  CreateCliSessionRequest,
  CreateRunRequest,
  CreateSkillRequest,
  CreateWorkflowRequest,
  SendCliMessageRequest,
  UpdateAgentRequest,
  UpdateSkillRequest,
  UpdateWorkflowRequest
} from "@agent-studio/shared";
import { ArtifactManager } from "./artifactManager";
import { CliChatService } from "./cliChatService";
import { apiPort, databasePath, ensureRuntimeDirs } from "./config";
import { StudioDatabase } from "./db";
import { RunEventBus } from "./eventBus";
import { WorkflowOrchestrator } from "./orchestrator";
import { WorkflowCatalog } from "./workflows";

await ensureRuntimeDirs();

const db = new StudioDatabase(databasePath);
const workflowCatalog = new WorkflowCatalog(db);
await workflowCatalog.seedFromYamlIfNeeded();
if (db.listAgents().length === 0) {
  db.createAgent({
    name: "General Analysis Agent",
    description: "Default mock agent for custom workflows.",
    provider: "mock",
    model: "mock-agent",
    systemPrompt: "Analyze the workflow input and produce concise, actionable artifacts.",
    outputFormats: ["markdown"],
    enabled: true
  });
}
const eventBus = new RunEventBus();
const artifactManager = new ArtifactManager(db);
const orchestrator = new WorkflowOrchestrator(db, artifactManager, eventBus, workflowCatalog);
const cliChatService = new CliChatService(db);

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/workflows", async (_request, response, next) => {
  try {
    response.json(workflowCatalog.listWorkflows());
  } catch (error) {
    next(error);
  }
});

app.get("/api/workflows/:workflowId", async (request, response, next) => {
  try {
    response.json(workflowCatalog.loadWorkflow(request.params.workflowId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/workflows", (request, response, next) => {
  try {
    response.status(201).json(workflowCatalog.createWorkflow(request.body as CreateWorkflowRequest));
  } catch (error) {
    next(error);
  }
});

app.put("/api/workflows/:workflowId", (request, response, next) => {
  try {
    response.json(workflowCatalog.updateWorkflow(request.params.workflowId, request.body as UpdateWorkflowRequest));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/workflows/:workflowId", (request, response, next) => {
  try {
    workflowCatalog.deleteWorkflow(request.params.workflowId);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/workflows/:workflowId/duplicate", (request, response, next) => {
  try {
    response.status(201).json(workflowCatalog.duplicateWorkflow(request.params.workflowId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/workflows/:workflowId/validate", (request, response, next) => {
  try {
    response.json(workflowCatalog.validateWorkflow((request.body as UpdateWorkflowRequest).workflow));
  } catch (error) {
    next(error);
  }
});

app.get("/api/studio/overview", (_request, response, next) => {
  try {
    response.json({
      workflows: workflowCatalog.listWorkflows(),
      agents: db.listAgents(),
      skills: db.listSkills(),
      recentRuns: db.listRecentRuns(8)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/agents", (_request, response, next) => {
  try {
    response.json(db.listAgents());
  } catch (error) {
    next(error);
  }
});

app.post("/api/agents", (request, response, next) => {
  try {
    response.status(201).json(db.createAgent(request.body as CreateAgentRequest));
  } catch (error) {
    next(error);
  }
});

app.get("/api/agents/:agentId", (request, response, next) => {
  try {
    response.json(db.getAgent(request.params.agentId));
  } catch (error) {
    next(error);
  }
});

app.put("/api/agents/:agentId", (request, response, next) => {
  try {
    response.json(db.updateAgent(request.params.agentId, request.body as UpdateAgentRequest));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/agents/:agentId", (request, response, next) => {
  try {
    db.deleteAgent(request.params.agentId);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/skills", (_request, response, next) => {
  try {
    response.json(db.listSkills());
  } catch (error) {
    next(error);
  }
});

app.post("/api/skills", (request, response, next) => {
  try {
    response.status(201).json(db.createSkill(request.body as CreateSkillRequest));
  } catch (error) {
    next(error);
  }
});

app.post("/api/skills/scan", async (_request, response, next) => {
  try {
    const scanned = await scanLocalSkills();
    response.json(scanned.map((skill) => db.upsertSkillBySourcePath(skill)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/skills/:skillId", (request, response, next) => {
  try {
    response.json(db.getSkill(request.params.skillId));
  } catch (error) {
    next(error);
  }
});

app.put("/api/skills/:skillId", (request, response, next) => {
  try {
    response.json(db.updateSkill(request.params.skillId, request.body as UpdateSkillRequest));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/skills/:skillId", (request, response, next) => {
  try {
    db.deleteSkill(request.params.skillId);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs", async (request, response, next) => {
  try {
    const body = request.body as CreateRunRequest;
    const files = body.inputPayload?.files ?? [];
    const hasFiles = Array.isArray(files) && files.length > 0;
    const hasFallbackText = Boolean(body.inputPayload?.prDiff?.trim() || body.inputPayload?.contextNote?.trim());

    if (!body.workflowId || (!hasFiles && !hasFallbackText)) {
      response.status(400).json({
        error: "workflowId and at least one local file or fallback text input are required."
      });
      return;
    }

    response.status(201).json(await orchestrator.createRun(body.workflowId, body.inputPayload));
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId", async (request, response, next) => {
  try {
    response.json(await orchestrator.getRunState(request.params.runId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId/events", (request, response, next) => {
  try {
    response.json(db.listEvents(request.params.runId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId/artifacts", (request, response, next) => {
  try {
    response.json(db.listArtifacts(request.params.runId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/artifacts/:artifactId", async (request, response, next) => {
  try {
    response.json(await orchestrator.readArtifact(request.params.artifactId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs/:runId/approval", async (request, response, next) => {
  try {
    const body = request.body as ApprovalRequest;
    if (body.action !== "approve" && body.action !== "reject") {
      response.status(400).json({ error: "action must be approve or reject." });
      return;
    }

    response.json(await orchestrator.resolveApproval(request.params.runId, body));
  } catch (error) {
    next(error);
  }
});

app.get("/api/cli/status", (_request, response, next) => {
  try {
    response.json(cliChatService.getStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/cli/sessions", (request, response, next) => {
  try {
    const body = request.body as CreateCliSessionRequest;
    response.status(201).json(cliChatService.createSession(body.context));
  } catch (error) {
    next(error);
  }
});

app.get("/api/cli/sessions/:sessionId", (request, response, next) => {
  try {
    response.json(cliChatService.getSession(request.params.sessionId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/cli/sessions/:sessionId/messages", (request, response, next) => {
  try {
    response.json(cliChatService.listMessages(request.params.sessionId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/cli/sessions/:sessionId/messages", async (request, response, next) => {
  try {
    const body = request.body as SendCliMessageRequest;
    if (!body.content?.trim()) {
      response.status(400).json({ error: "content is required." });
      return;
    }

    response.status(202).json(await cliChatService.sendMessage(request.params.sessionId, body.content, body.context));
  } catch (error) {
    next(error);
  }
});

app.post("/api/cli/sessions/:sessionId/stop", (request, response, next) => {
  try {
    response.json(cliChatService.stopSession(request.params.sessionId));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(500).json({ error: message });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", `http://${request.headers.host ?? "localhost"}`);
  const runMatch = url.pathname.match(/^\/ws\/runs\/([^/]+)$/);
  const cliMatch = url.pathname.match(/^\/ws\/cli\/sessions\/([^/]+)$/);

  if (!runMatch && !cliMatch) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (runMatch) {
      const runId = runMatch[1];
      for (const event of db.listEvents(runId)) {
        ws.send(JSON.stringify(event));
      }

      const unsubscribe = orchestrator.subscribe(runId, (event) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(event));
        }
      });

      ws.on("close", unsubscribe);
      return;
    }

    const sessionId = cliMatch?.[1] ?? "";
    for (const event of cliChatService.historyEvents(sessionId)) {
      ws.send(JSON.stringify(event));
    }

    const unsubscribe = cliChatService.subscribe(sessionId, (event) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(event));
      }
    });

    ws.on("close", unsubscribe);
  });
});

server.listen(apiPort, () => {
  console.log(`Agent Studio API listening on http://localhost:${apiPort}`);
});

async function scanLocalSkills(): Promise<CreateSkillRequest[]> {
  const roots = [
    path.join(os.homedir(), ".codex", "skills"),
    path.join(os.homedir(), ".agents", "skills")
  ];
  const skills: CreateSkillRequest[] = [];

  for (const root of roots) {
    for (const filePath of await findSkillFiles(root, 4)) {
      const content = await readFile(filePath, "utf8");
      const name = path.basename(path.dirname(filePath));
      const description = extractSkillDescription(content);
      skills.push({
        name,
        description,
        content,
        sourcePath: filePath,
        enabled: true
      });
    }
  }

  return skills;
}

async function findSkillFiles(root: string, depth: number): Promise<string[]> {
  if (depth < 0) {
    return [];
  }

  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
      files.push(entryPath);
    }
    if (entry.isDirectory()) {
      files.push(...await findSkillFiles(entryPath, depth - 1));
    }
  }
  return files;
}

function extractSkillDescription(content: string): string {
  const frontmatter = content.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  const frontmatterDescription = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (frontmatterDescription) {
    return frontmatterDescription.replace(/^["']|["']$/g, "").slice(0, 240);
  }

  const firstParagraph = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("---"));
  return firstParagraph?.slice(0, 240) ?? "Local skill";
}
