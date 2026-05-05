import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { WebSocket } from "ws";
import type {
  CliProviderStatusResponse,
  CliTerminalEvent,
  CliTerminalInputEvent
} from "@agent-studio/shared";
import { cliCorePath, workspaceRoot } from "./config";

type CliLaunchTarget = {
  command: string;
  args: string[];
  entrypoint: string;
};

type ActiveTerminal = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  socket: WebSocket;
  closedByClient: boolean;
};

export class CliTerminalService {
  private activeTerminal?: ActiveTerminal;

  getStatus(): CliProviderStatusResponse {
    const target = this.resolveLaunchTarget();
    const bunAvailable = isCommandAvailable("bun");
    const distEntry = path.join(cliCorePath, "dist", "cli-node.js");
    const hasCliCore = existsSync(cliCorePath);
    const hasDistEntry = existsSync(distEntry);
    const hasNodeModules = existsSync(path.join(cliCorePath, "node_modules"));
    const dependenciesInstalled = hasNodeModules;

    if (this.activeTerminal) {
      return {
        status: "running",
        cliCorePath,
        entrypoint: this.activeTerminal ? target?.entrypoint : undefined,
        command: this.activeTerminal ? target?.command : undefined,
        bunAvailable,
        dependenciesInstalled,
        message: "D_RD terminal is currently connected."
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
      message: "D_RD terminal is ready."
    };
  }

  connect(socket: WebSocket): void {
    if (this.activeTerminal) {
      sendEvent(socket, {
        type: "error",
        status: "error",
        message: "Another D_RD terminal is already connected.",
        data: "Another D_RD terminal is already connected.\r\n"
      });
      socket.close(1013, "D_RD terminal already connected");
      return;
    }

    const launchTarget = this.resolveLaunchTarget();
    if (!launchTarget) {
      const status = this.getStatus();
      sendEvent(socket, {
        type: "status",
        status: status.status,
        message: status.message
      });
      sendEvent(socket, {
        type: "output",
        status: status.status,
        data: buildNotReadyMessage(status)
      });
      sendEvent(socket, {
        type: "exit",
        status: "closed",
        exitCode: null,
        signal: null,
        message: "D_RD terminal is not ready."
      });
      socket.close(1011, "D_RD terminal is not ready");
      return;
    }

    sendEvent(socket, {
      type: "status",
      status: "connecting",
      message: "Starting D_RD terminal."
    });

    const child = spawn(launchTarget.command, launchTarget.args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        COREPACK_ENABLE_AUTO_PIN: "0"
      },
      windowsHide: true
    });

    const active: ActiveTerminal = {
      id: crypto.randomUUID(),
      child,
      socket,
      closedByClient: false
    };
    this.activeTerminal = active;

    sendEvent(socket, {
      type: "status",
      status: "running",
      message: "D_RD terminal connected."
    });
    sendEvent(socket, {
      type: "output",
      status: "running",
      data: `D_RD terminal connected.\r\n${launchTarget.command} ${launchTarget.args.join(" ")}\r\n\r\n`
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.sendToActive(active.id, {
        type: "output",
        status: "running",
        data: chunk.toString("utf8")
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      this.sendToActive(active.id, {
        type: "output",
        status: "running",
        data: chunk.toString("utf8")
      });
    });

    child.on("error", (error) => {
      this.sendToActive(active.id, {
        type: "error",
        status: "error",
        message: error.message,
        data: `\r\nD_RD failed to start: ${error.message}\r\n`
      });
    });

    child.on("close", (code, signal) => {
      const current = this.activeTerminal;
      if (current?.id === active.id) {
        this.activeTerminal = undefined;
      }
      sendEvent(socket, {
        type: "exit",
        status: active.closedByClient ? "closed" : code === 0 ? "closed" : "error",
        exitCode: code,
        signal,
        message: `D_RD exited with code ${code ?? "n/a"}${signal ? ` (${signal})` : ""}.`,
        data: `\r\nD_RD exited with code ${code ?? "n/a"}${signal ? ` (${signal})` : ""}.\r\n`
      });
      if (socket.readyState === socket.OPEN) {
        socket.close();
      }
    });

    socket.on("message", (rawMessage) => {
      this.handleClientMessage(active.id, rawMessage.toString());
    });

    socket.on("close", () => {
      const current = this.activeTerminal;
      if (current?.id !== active.id) {
        return;
      }

      current.closedByClient = true;
      this.activeTerminal = undefined;
      current.child.kill();
    });
  }

  private resolveLaunchTarget(): CliLaunchTarget | undefined {
    const distEntry = path.join(cliCorePath, "dist", "cli-node.js");
    if (existsSync(distEntry)) {
      return {
        command: process.execPath,
        args: [
          distEntry,
          "--permission-mode",
          "plan"
        ],
        entrypoint: distEntry
      };
    }

    return undefined;
  }

  private handleClientMessage(activeId: string, rawMessage: string): void {
    const active = this.activeTerminal;
    if (!active || active.id !== activeId) {
      return;
    }

    let event: CliTerminalInputEvent;
    try {
      event = JSON.parse(rawMessage) as CliTerminalInputEvent;
    } catch {
      event = { type: "input", data: rawMessage };
    }

    if (event.type === "input") {
      active.child.stdin.write(event.data);
      return;
    }

    if (event.type === "interrupt") {
      active.closedByClient = true;
      active.child.kill();
    }
  }

  private sendToActive(activeId: string, event: Omit<CliTerminalEvent, "id" | "createdAt">): void {
    const active = this.activeTerminal;
    if (!active || active.id !== activeId) {
      return;
    }
    sendEvent(active.socket, event);
  }
}

function sendEvent(socket: WebSocket, event: Omit<CliTerminalEvent, "id" | "createdAt">): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...event
  } satisfies CliTerminalEvent));
}

function isCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  return !result.error && result.status === 0;
}

function buildNotReadyMessage(status: CliProviderStatusResponse): string {
  return [
    `D_RD terminal is not ready: ${status.message}`,
    "",
    `CLI core path: ${status.cliCorePath}`,
    "",
    "Expected setup:",
    "  cd vendor/D_RD",
    "  bun install",
    "  bun run build",
    "",
    "Then reconnect the D_RD terminal.",
    ""
  ].join("\r\n");
}
