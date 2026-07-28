import { createSandboxInstance, resolveSandbox } from "../sandbox/resolve.ts";
import { stopSandbox } from "../sandbox/registry.ts";
import type { Sandbox, SandboxHookContext, SandboxOption, ScopedFeedback } from "../types.ts";
import { createChangeLedger, type ChangeLedger } from "./ledger.ts";

const CLEANUP_RESERVE_MS = 30_000;

export interface ReusableSandboxLease {
  readonly sandbox: Sandbox;
  readonly reuseSandbox: number;
  readonly reuseOrdinal: number;
  release(reset: boolean): Promise<void>;
}

interface Entry {
  sandbox: Sandbox & { ensureLifetime?: (minRemainingMs: number) => Promise<{ ready: boolean; reason?: string }> };
  ledger: ChangeLedger;
  reuseSandbox: number;
  ordinal: number;
  busy: boolean;
  dead: boolean;
}

/** 一个解析后的 SandboxSpec 的按需复用池；实例始终独占借给单条 Attempt。 */
export class ReusableSandboxPool {
  private readonly entries: Entry[] = [];
  private readonly waiters: Array<() => void> = [];
  private creating = 0;
  private stopped = false;

  constructor(
    private readonly spec: SandboxOption,
    private readonly capacity: number,
    private readonly feedback: ScopedFeedback,
    private readonly setupContext: SandboxHookContext,
  ) {}

  async acquire(timeoutMs: number): Promise<ReusableSandboxLease> {
    for (;;) {
      if (this.stopped) throw new Error("sandbox reuse pool has been stopped");
      const ready = this.entries.find((entry) => !entry.busy && !entry.dead);
      if (ready) {
        const lifetime = await ready.sandbox.ensureLifetime?.(timeoutMs + CLEANUP_RESERVE_MS);
        if (lifetime?.ready) return this.lease(ready);
        await this.retire(ready);
        continue;
      }
      if (this.entries.length + this.creating < this.capacity) {
        this.creating += 1;
        try {
          const entry = await this.create();
          this.entries.push(entry);
          return this.lease(entry);
        } finally {
          this.creating -= 1;
          this.wake();
        }
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake();
    await Promise.allSettled(this.entries.map((entry) => this.retire(entry)));
  }

  private async create(): Promise<Entry> {
    const resolved = resolveSandbox(this.spec);
    if (resolved.provider === "local" || resolved.create !== undefined) {
      throw new Error(
        `sandboxReuse is not supported with ${resolved.provider === "local" ? "localSandbox()" : `defineSandbox custom provider "${resolved.provider}"`}; use an built-in reusable provider.`,
      );
    }
    const sandbox = await createSandboxInstance({ sandbox: this.spec, feedback: this.feedback });
    const capability = sandbox.ensureLifetime;
    if (!capability) {
      await stopSandbox(sandbox);
      throw new Error(`sandboxReuse requires ${resolved.provider} to implement ensureLifetime(minRemainingMs)`);
    }
    const lifetime = await capability(CLEANUP_RESERVE_MS);
    if (!lifetime.ready) {
      await stopSandbox(sandbox);
      throw new Error(`sandboxReuse cannot prepare ${resolved.provider}: ${lifetime.reason ?? "insufficient lifetime"}`);
    }
    try {
      for (const hook of this.spec.setupHooks ?? []) await hook(sandbox, this.setupContext);
      const ledger = await createChangeLedger(sandbox);
      return {
        sandbox,
        ledger,
        reuseSandbox: this.entries.length + 1,
        ordinal: 0,
        busy: false,
        dead: false,
      };
    } catch (error) {
      for (const hook of [...(this.spec.teardownHooks ?? [])].reverse()) {
        await Promise.resolve(hook(sandbox, this.setupContext)).catch(() => {});
      }
      await stopSandbox(sandbox);
      throw error;
    }
  }

  private lease(entry: Entry): ReusableSandboxLease {
    entry.busy = true;
    entry.ordinal += 1;
    return {
      sandbox: entry.sandbox,
      reuseSandbox: entry.reuseSandbox,
      reuseOrdinal: entry.ordinal,
      release: async (reset) => {
        try {
          if (reset && !entry.dead) await entry.ledger.resetToAnchor();
        } catch {
          await this.retire(entry);
        } finally {
          entry.busy = false;
          this.wake();
        }
      },
    };
  }

  private async retire(entry: Entry): Promise<void> {
    if (entry.dead) return;
    entry.dead = true;
    try {
      for (const hook of [...(this.spec.teardownHooks ?? [])].reverse()) {
        await Promise.resolve(hook(entry.sandbox, this.setupContext)).catch(() => {});
      }
    } finally {
      await stopSandbox(entry.sandbox);
      this.wake();
    }
  }

  private wake(): void {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
}
