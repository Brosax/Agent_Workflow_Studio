import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  CliChatContext,
  CliChatMessage,
  CliChatSession,
  CliChatStatus,
  CliProviderStatusResponse,
  CliStreamEvent
} from "@agent-studio/shared";
import { cliCorePath, workspaceRoot } from "./config";
import { StudioDatabase } from "./db";

type CliSubscriber = (event: CliStreamEvent) => void;

type ActiveCliProcess = {
  child: ChildProcessWithoutNullStreams;
  assistantMessageId: string;
  stderr: string;
  stdoutBuffer: string;
  contentWritten: boolean;
  cancelled: boolean;
};

type CliLaunchTarget = {
  command: string;
  args: string[];
  entrypoint: string;
};

type ParsedStreamLine =
  | { kind: "none" }
  | { kind: "append"; text: string }
  | { kind: "assistant_full"; text: string };

export class CliChatService {
  private readonly subscribers = new Map<string, Set<CliSubscriber>>();
  private readonly activeProcesses = new Map<string, ActiveCliProcess>();

  constructor(private readonly db: StudioDatabase) {}

  getStatus(): CliProviderStatusResponse {
    const target = this.resolveLaunchTarget();
    const bunAvailable = isCommandAvailable("bun");
    const distEntry = path.join(cliCorePath, "dist", "cli-node.js");
    const hasCliCore = existsSync(cliCorePath);
    const hasDistEntry = existsSync(distEntry);
    const hasNodeModules = existsSync(path.join(cliCorePath, "node_modules"));
    const dependenciesInstalled = hasNodeModules;

    if (this.activeProcesses.size > 0) {
      return {
        status: "running",
        cliCorePath,
        entrypoint: target?.entrypoint,
        command: target?.command,
        bunAvailable,
        dependenciesInstalled,
        message: "D_RD is currently handling a chat request."
      };
    }

    if (!hasCliCore) {
      return {
        status: "not_ready",
        cliCorePath,
        bunAvailable,
        dependenciesInstalled: false,
        message: "CLI core path does not exist. Clone or restore vendor/D_RD first."
      };
    }

    if (!hasDistEntry && !existsSync(path.join(cliCorePath, "src", "entrypoints", "cli.tsx"))) {
      return {
        status: "not_ready",
        cliCorePath,
        bunAvailable,
        dependenciesInstalled,
        message: "D_RD entrypoint was not found. Expected dist/cli-node.js."
      };
    }

    if (!target) {
      return {
        status: "not_ready",
        cliCorePath,
        bunAvailable,
        dependenciesInstalled,
        message: hasNodeModules
          ? "D_RD build output is missing. Run `bun run build` inside vendor/D_RD."
          : "D_RD dependencies are missing. Run `bun install` then `bun run build` inside vendor/D_RD."
      };
    }

    return {
      status: "ready",
      cliCorePath,
      entrypoint: target.entrypoint,
      command: target.command,
      bunAvailable,
      dependenciesInstalled,
      message: "D_RD headless CLI is ready."
    };
  }

  createSession(context?: CliChatContext): CliChatSession {
    return this.db.createCliSession({ metadata: { context } });
  }

  getSession(sessionId: string): CliChatSession {
    return this.db.getCliSession(sessionId);
  }

  listMessages(sessionId: string): CliChatMessage[] {
    this.db.getCliSession(sessionId);
    return this.db.listCliMessages(sessionId);
  }

  subscribe(sessionId: string, subscriber: CliSubscriber): () => void {
    const subscribers = this.subscribers.get(sessionId) ?? new Set<CliSubscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(sessionId, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  historyEvents(sessionId: string): CliStreamEvent[] {
    const session = this.db.getCliSession(sessionId);
    return [
      {
        id: crypto.randomUUID(),
        sessionId,
        type: "status",
        status: session.status,
        createdAt: new Date().toISOString()
      },
      ...this.db.listCliMessages(sessionId).map((message) => ({
        id: crypto.randomUUID(),
        sessionId,
        type: "message_created" as const,
        messageId: message.id,
        message,
        createdAt: message.createdAt
      }))
    ];
  }

  async sendMessage(
    sessionId: string,
    content: string,
    context?: CliChatContext
  ): Promise<{ session: CliChatSession; userMessage: CliChatMessage; assistantMessage: CliChatMessage }> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new Error("Message content is required.");
    }

    if (this.activeProcesses.has(sessionId)) {
      throw new Error("This CLI chat session is already running.");
    }

    const launchTarget = this.resolveLaunchTarget();
    if (!launchTarget) {
      const status = this.getStatus();
      throw new Error(status.message);
    }

    this.db.getCliSession(sessionId);
    const previousMessages = this.db.listCliMessages(sessionId);
    const userMessage = this.db.createCliMessage({
      sessionId,
      role: "user",
      content: trimmedContent,
      metadata: { context }
    });
    const assistantMessage = this.db.createCliMessage({
      sessionId,
      role: "assistant",
      content: "",
      metadata: { provider: "D_RD", mode: "headless", permissionMode: "plan" }
    });

    this.emitMessage(sessionId, userMessage);
    this.emitMessage(sessionId, assistantMessage);
    const runningSession = this.db.updateCliSessionStatus(sessionId, "running");
    this.emitStatus(runningSession);

    const prompt = buildPrompt(trimmedContent, context, previousMessages);
    const child = spawn(launchTarget.command, launchTarget.args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        COREPACK_ENABLE_AUTO_PIN: "0"
      },
      windowsHide: true
    });

    const active: ActiveCliProcess = {
      child,
      assistantMessageId: assistantMessage.id,
      stderr: "",
      stdoutBuffer: "",
      contentWritten: false,
      cancelled: false
    };
    this.activeProcesses.set(sessionId, active);

    child.stdout.on("data", (chunk: Buffer) => {
      this.handleStdout(sessionId, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      active.stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      active.stderr += error.message;
    });

    child.on("close", (code, signal) => {
      this.finishProcess(sessionId, code, signal);
    });

    child.stdin.write(prompt);
    child.stdin.end();

    return { session: runningSession, userMessage, assistantMessage };
  }

  stopSession(sessionId: string): CliChatSession {
    const active = this.activeProcesses.get(sessionId);
    if (!active) {
      return this.db.getCliSession(sessionId);
    }

    active.cancelled = true;
    active.child.kill();
    const session = this.db.updateCliSessionStatus(sessionId, "cancelled", "User stopped the CLI request.");
    this.emitStatus(session);
    this.emit({
      id: crypto.randomUUID(),
      sessionId,
      type: "cancelled",
      status: "cancelled",
      createdAt: new Date().toISOString()
    });
    return session;
  }

  private resolveLaunchTarget(): CliLaunchTarget | undefined {
    const distEntry = path.join(cliCorePath, "dist", "cli-node.js");
    if (existsSync(distEntry)) {
      return {
        command: process.execPath,
        args: [
          distEntry,
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "plan",
          "--max-turns",
          "4"
        ],
        entrypoint: distEntry
      };
    }

    return undefined;
  }

  private handleStdout(sessionId: string, chunk: string): void {
    const active = this.activeProcesses.get(sessionId);
    if (!active) {
      return;
    }

    active.stdoutBuffer += chunk;
    const lines = active.stdoutBuffer.split(/\r?\n/);
    active.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      const parsed = extractTextFromStreamLine(trimmedLine);
      if (parsed.kind === "none") {
        continue;
      }

      let chunkContent = "";
      if (parsed.kind === "assistant_full") {
        if (active.contentWritten) {
          continue;
        }
        active.contentWritten = true;
        this.db.replaceCliMessageContent(active.assistantMessageId, parsed.text);
        chunkContent = parsed.text;
      } else {
        active.contentWritten = true;
        this.db.appendCliMessageContent(active.assistantMessageId, parsed.text);
        chunkContent = parsed.text;
      }

      this.emit({
        id: crypto.randomUUID(),
        sessionId,
        type: "chunk",
        messageId: active.assistantMessageId,
        content: chunkContent,
        createdAt: new Date().toISOString()
      });
    }
  }

  private finishProcess(sessionId: string, code: number | null, signal: NodeJS.Signals | null): void {
    const active = this.activeProcesses.get(sessionId);
    if (!active) {
      return;
    }

    if (active.stdoutBuffer.trim()) {
      const parsed = extractTextFromStreamLine(active.stdoutBuffer.trim());
      if (parsed.kind !== "none") {
        const text = parsed.text;
        active.contentWritten = true;
        this.db.appendCliMessageContent(active.assistantMessageId, text);
        this.emit({
          id: crypto.randomUUID(),
          sessionId,
          type: "chunk",
          messageId: active.assistantMessageId,
          content: text,
          createdAt: new Date().toISOString()
        });
      }
    }

    this.activeProcesses.delete(sessionId);

    if (active.cancelled) {
      return;
    }

    const stderr = active.stderr.trim();
    if (code && code !== 0) {
      const errorMessage = stderr || `D_RD exited with code ${code}${signal ? ` (${signal})` : ""}.`;
      if (!active.contentWritten) {
        this.db.replaceCliMessageContent(active.assistantMessageId, `D_RD failed: ${errorMessage}`);
      }
      const session = this.db.updateCliSessionStatus(sessionId, "error", errorMessage);
      this.emitStatus(session);
      this.emit({
        id: crypto.randomUUID(),
        sessionId,
        type: "error",
        messageId: active.assistantMessageId,
        error: errorMessage,
        status: "error",
        createdAt: new Date().toISOString()
      });
      return;
    }

    if (!active.contentWritten) {
      const fallback = stderr || "D_RD completed without text output.";
      this.db.replaceCliMessageContent(active.assistantMessageId, fallback);
      this.emit({
        id: crypto.randomUUID(),
        sessionId,
        type: "chunk",
        messageId: active.assistantMessageId,
        content: fallback,
        createdAt: new Date().toISOString()
      });
    }

    const session = this.db.updateCliSessionStatus(sessionId, "completed");
    this.emitStatus(session);
    this.emit({
      id: crypto.randomUUID(),
      sessionId,
      type: "completed",
      status: "completed",
      createdAt: new Date().toISOString()
    });
  }

  private emitMessage(sessionId: string, message: CliChatMessage): void {
    this.emit({
      id: crypto.randomUUID(),
      sessionId,
      type: "message_created",
      messageId: message.id,
      message,
      createdAt: message.createdAt
    });
  }

  private emitStatus(session: CliChatSession): void {
    this.emit({
      id: crypto.randomUUID(),
      sessionId: session.id,
      type: "status",
      status: session.status,
      error: session.lastError,
      createdAt: new Date().toISOString()
    });
  }

  private emit(event: CliStreamEvent): void {
    const subscribers = this.subscribers.get(event.sessionId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber(event);
    }
  }
}

function isCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  return !result.error && result.status === 0;
}

function buildPrompt(
  userMessage: string,
  context: CliChatContext | undefined,
  previousMessages: CliChatMessage[]
): string {
  const recentMessages = previousMessages.slice(-8);
  const transcript = recentMessages
    .map((message) => `${message.role.toUpperCase()}: ${trimForPrompt(message.content, 1400)}`)
    .join("\n\n");
  const files = context?.localFiles?.length
    ? context.localFiles
        .map((file) => `- ${file.relativePath || file.name} (${file.size} bytes)`)
        .join("\n")
    : "- none attached";

  return [
    "You are connected through Enterprise Agent Workflow Studio as a read-only headless CLI assistant.",
    "Stay in planning and analysis mode. Do not modify files, run dangerous commands, or bypass permissions.",
    "If implementation is needed, explain the exact change and wait for the user to approve through the Studio.",
    "",
    "Workspace context:",
    `- Workspace root: ${workspaceRoot}`,
    `- Workflow: ${context?.workflowName ?? context?.workflowId ?? "n/a"}`,
    `- Run: ${context?.runId ?? "n/a"} (${context?.runStatus ?? "n/a"})`,
    `- Selected node: ${context?.selectedNodeName ?? context?.selectedNodeId ?? "n/a"}`,
    `- Review context: ${context?.contextNote ?? "n/a"}`,
    "Attached local file summaries:",
    files,
    "",
    transcript ? `Recent Studio chat transcript:\n${transcript}\n` : "",
    "User message:",
    userMessage
  ]
    .filter(Boolean)
    .join("\n");
}

function trimForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n[truncated]`;
}

function extractTextFromStreamLine(line: string): ParsedStreamLine {
  try {
    const parsed = JSON.parse(line) as unknown;
    return extractTextFromMessage(parsed);
  } catch {
    return { kind: "append", text: line };
  }
}

function extractTextFromMessage(value: unknown): ParsedStreamLine {
  if (!isRecord(value)) {
    return { kind: "none" };
  }

  if (value.type === "content_block_delta" && isRecord(value.delta) && typeof value.delta.text === "string") {
    return { kind: "append", text: value.delta.text };
  }

  if (value.type === "assistant" && isRecord(value.message)) {
    const text = extractContentText(value.message.content);
    return text ? { kind: "assistant_full", text } : { kind: "none" };
  }

  if (value.type === "error" && typeof value.message === "string") {
    return { kind: "append", text: `Error: ${value.message}` };
  }

  return { kind: "none" };
}

function extractContentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }

      if (typeof item.content === "string") {
        return item.content;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
