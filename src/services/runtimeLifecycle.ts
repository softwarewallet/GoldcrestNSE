export type RuntimeLifecycleState = 'STARTING' | 'RUNNING' | 'DEGRADED' | 'STOPPING' | 'STOPPED';

export interface RuntimeLifecycleStatus {
  state: RuntimeLifecycleState;
  shutdownRequested: boolean;
  registeredCleanupCount: number;
  lastTransitionAt: number;
  lastShutdownReason: string | null;
}

type Cleanup = {
  name: string;
  run: () => void | Promise<void>;
};

const ALLOWED_TRANSITIONS: Record<RuntimeLifecycleState, RuntimeLifecycleState[]> = {
  STARTING: ['RUNNING', 'DEGRADED', 'STOPPING'],
  RUNNING: ['RUNNING', 'DEGRADED', 'STOPPING'],
  DEGRADED: ['RUNNING', 'DEGRADED', 'STOPPING'],
  STOPPING: ['STOPPING', 'STOPPED'],
  STOPPED: ['STOPPED']
};

export class RuntimeLifecycleCoordinator {
  private state: RuntimeLifecycleState = 'STARTING';
  private shutdownRequested = false;
  private lastTransitionAt = Date.now();
  private lastShutdownReason: string | null = null;
  private readonly cleanups: Cleanup[] = [];
  private shutdownPromise: Promise<{ completed: string[]; failed: string[] }> | null = null;

  registerCleanup(name: string, run: () => void | Promise<void>): void {
    if (!name.trim()) throw new Error('RUNTIME_CLEANUP_NAME_REQUIRED');
    if (this.state === 'STOPPING') {
      throw new Error('RUNTIME_ALREADY_STOPPING');
    }
    if (this.state === 'STOPPED') {
      throw new Error('RUNTIME_LIFECYCLE_STOPPED');
    }
    this.cleanups.push({ name, run });
  }

  transition(next: RuntimeLifecycleState): RuntimeLifecycleStatus {
    if (!ALLOWED_TRANSITIONS[this.state].includes(next)) {
      throw new Error(`INVALID_RUNTIME_LIFECYCLE_TRANSITION:${this.state}->${next}`);
    }
    this.state = next;
    this.lastTransitionAt = Date.now();
    return this.getStatus();
  }

  getStatus(): RuntimeLifecycleStatus {
    return {
      state: this.state,
      shutdownRequested: this.shutdownRequested,
      registeredCleanupCount: this.cleanups.length,
      lastTransitionAt: this.lastTransitionAt,
      lastShutdownReason: this.lastShutdownReason
    };
  }

  async shutdown(reason: string): Promise<{ completed: string[]; failed: string[] }> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shutdownRequested = true;
    this.lastShutdownReason = String(reason || 'UNSPECIFIED');
    this.transition('STOPPING');

    this.shutdownPromise = (async () => {
      const completed: string[] = [];
      const failed: string[] = [];

      for (const cleanup of [...this.cleanups].reverse()) {
        try {
          await cleanup.run();
          completed.push(cleanup.name);
        } catch {
          failed.push(cleanup.name);
        }
      }

      this.transition('STOPPED');
      return { completed, failed };
    })();

    return this.shutdownPromise;
  }
}

export const runtimeLifecycle = new RuntimeLifecycleCoordinator();
