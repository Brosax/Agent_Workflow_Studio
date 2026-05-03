import type { RunEvent } from "@agent-studio/shared";

export type RunEventListener = (event: RunEvent) => void;

export class RunEventBus {
  private readonly listeners = new Map<string, Set<RunEventListener>>();

  subscribe(runId: string, listener: RunEventListener): () => void {
    const listenersForRun = this.listeners.get(runId) ?? new Set<RunEventListener>();
    listenersForRun.add(listener);
    this.listeners.set(runId, listenersForRun);

    return () => {
      listenersForRun.delete(listener);
      if (listenersForRun.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  publish(event: RunEvent): void {
    for (const listener of this.listeners.get(event.workflowRunId) ?? []) {
      listener(event);
    }
  }
}

