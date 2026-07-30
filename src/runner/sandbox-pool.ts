import { createSandboxInstance, resolveSandbox, sandboxReuseCapability } from "../sandbox/resolve.ts";
import { stopSandbox } from "../sandbox/registry.ts";
import type { Sandbox, SandboxHookContext, SandboxOption, SandboxReuseCapability, ScopedFeedback } from "../types.ts";
import { createChangeLedger, type ChangeLedger } from "./ledger.ts";

const CLEANUP_RESERVE_MS = 30_000;

export interface ReusableSandboxLease {
  readonly sandbox: Sandbox;
  readonly reuseSandbox: number;
  readonly reuseOrdinal: number;
  release(reset: boolean): Promise<void>;
}

interface Entry {
  sandbox: Sandbox;
  /** provider 自己实现的寿命确认;没有这条能力的实例根本进不来(见 create)。 */
  lifetime: SandboxReuseCapability;
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
  /** 本次 Run 内的 Sandbox 编号计数器;淘汰的实例不让号,编号在结果里永远指向同一个实例。 */
  private created = 0;

  constructor(
    private readonly spec: SandboxOption,
    private readonly capacity: number,
    private readonly feedback: ScopedFeedback,
    private readonly setupContext: SandboxHookContext,
  ) {}

  /**
   * @param attemptDeadlineMs 这条 Attempt 实际生效的超时上限(解析链见 runner/timeout.ts)。
   * `undefined` = 四层都没声明上限:请求的寿命只能覆盖收尾预留——Attempt 本身没有 deadline,
   * 池无从知道它要跑多久,也不替它编一个数。此后实例被 provider 按自己的 `lifetimeMs` 回收
   * 就是「不声明上限」的代价(两种时间的分界见 docs/feature/sandbox/reuse.md)。
   */
  async acquire(attemptDeadlineMs: number | undefined): Promise<ReusableSandboxLease> {
    const minRemainingMs = (attemptDeadlineMs ?? 0) + CLEANUP_RESERVE_MS;
    for (;;) {
      if (this.stopped) throw new Error("sandbox reuse pool has been stopped");
      const ready = this.entries.find((entry) => !entry.busy && !entry.dead);
      if (ready) {
        // 派发前确认:请求足以覆盖 Attempt deadline 与收尾预留的寿命。不 ready 就停掉这台、
        // 交给下一轮创建替代实例(替代实例在 create 里再确认一次,还不行就报错,不反复重建)。
        const lifetime = await ready.lifetime.ensureLifetime(minRemainingMs);
        if (lifetime.ready) return this.lease(ready);
        await this.retire(ready);
        continue;
      }
      if (this.entries.length + this.creating < this.capacity) {
        this.creating += 1;
        try {
          const entry = await this.create(minRemainingMs);
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
    await Promise.allSettled([...this.entries].map((entry) => this.retire(entry)));
  }

  private async create(minRemainingMs: number): Promise<Entry> {
    const resolved = resolveSandbox(this.spec);
    const sandbox = await createSandboxInstance({ sandbox: this.spec, feedback: this.feedback });
    // 能力只能来自 provider 实现:探不到就硬失败,没有通用记账兜底(见
    // docs/feature/sandbox/reuse.md「派发前确认」)。
    const lifetime = sandboxReuseCapability(sandbox);
    if (!lifetime) {
      await stopSandbox(sandbox);
      throw new Error(
        `sandboxReuse needs the "${resolved.provider}" provider to confirm sandbox lifetime, but it does not implement ` +
          "ensureLifetime(minRemainingMs). Only a provider can prove the lifetime is set on its own backend; the runner " +
          "will not keep local books for it. Use a provider that implements it (docker / e2b / vercel), or drop sandboxReuse.",
      );
    }
    const confirmed = await lifetime.ensureLifetime(minRemainingMs);
    if (!confirmed.ready) {
      await stopSandbox(sandbox);
      throw new Error(`sandboxReuse cannot prepare the "${resolved.provider}" sandbox: ${confirmed.reason}`);
    }
    try {
      for (const hook of this.spec.setupHooks ?? []) await hook(sandbox, this.setupContext);
      const ledger = await createChangeLedger(sandbox);
      // SandboxSpec setup 自己会烧掉寿命:备好之后再确认一次。这次不够就报错收场——
      // 反复创建同样的替代实例只会反复烧同样的时间(见 reuse.md「派发前确认」)。
      const afterSetup = await lifetime.ensureLifetime(minRemainingMs);
      if (!afterSetup.ready) {
        throw new Error(
          `sandboxReuse cannot use the "${resolved.provider}" sandbox after its SandboxSpec setup: ${afterSetup.reason}`,
        );
      }
      this.created += 1;
      return {
        sandbox,
        lifetime,
        ledger,
        reuseSandbox: this.created,
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

  /** 淘汰一台实例:跑 SandboxSpec teardown、停实例,并移出池——留在池里会占满容量,
   *  让后续 acquire 既等不到空闲实例、也创建不出替代实例(等待者永远醒不来)。 */
  private async retire(entry: Entry): Promise<void> {
    if (entry.dead) return;
    entry.dead = true;
    const at = this.entries.indexOf(entry);
    if (at >= 0) this.entries.splice(at, 1);
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
