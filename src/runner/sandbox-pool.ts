import { applyCommandDeadline } from "../sandbox/deadline.ts";
import { sandboxReuseCapability } from "../sandbox/backend.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import type { BuildKey } from "../sandbox/identity.ts";
import {
  materializeSandboxRunPlan,
  liveSandboxRuntimeServices,
  sandboxRuntimeCapabilities,
  type SandboxRuntimeDeadline,
  type SandboxRuntimeServices,
} from "../sandbox/runtime.ts";
import type { JsonValue, Sandbox, SandboxAgent, SandboxHookContext, SandboxReuseCapability, ScopedFeedback } from "../types.ts";
import { CLEANUP_TIMEOUT_MS } from "./cleanup-timeout.ts";
import { createChangeLedger, type ChangeLedger } from "./ledger.ts";
import {
  materializeSelectedPluginResources,
  type MaterializedPluginResources,
  type SelectedResourceEnvelope,
} from "../plugin/resource-runtime.ts";
import type { SandboxResourceTiming } from "../plugin/contracts.ts";
import { firstLine, formatThrown } from "../util.ts";
import { Effect, Either, Exit, Scope } from "effect";

export interface ReusableSandboxLease {
  readonly sandbox: Sandbox;
  readonly reuseSandbox: number;
  readonly reuseOrdinal: number;
  /** Physical resource handles live with the pool entry, not this lease Scope. */
  readonly resources?: MaterializedPluginResources;
  /** 提交本次 Attempt 的归还决策；Scope 退出负责实际 reset/retire，漏提交默认 Retire。 */
  commit(disposition: ReusableLeaseRelease): Effect.Effect<void>;
}

export type ReusableLeaseRelease =
  | { readonly _tag: "Reset" }
  | { readonly _tag: "Retire" };

/** A post-attempt physical lifecycle failure observed after its result sealed. */
export interface ReusableSandboxPoolRuntimeFailure {
  readonly stage: "sandbox.reset";
  readonly error: Error;
}

type EntryLifecycle =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Leased" }
  | { readonly _tag: "Retired" };

interface Entry {
  sandbox: Sandbox;
  scope: Scope.CloseableScope;
  /** provider 自己实现的寿命确认;没有这条能力的实例根本进不来(见 create)。 */
  lifetime: SandboxReuseCapability;
  ledger: ChangeLedger;
  resources?: MaterializedPluginResources;
  reuseSandbox: number;
  ordinal: number;
  lifecycle: EntryLifecycle;
}

/** Scope 尚未关闭前，lease 只能在这里两种归还意图之间演进。 */
type LeaseReleaseDecision =
  | { readonly _tag: "Uncommitted" }
  | { readonly _tag: "Committed"; readonly release: ReusableLeaseRelease };

/** 漏 commit 保持 Uncommitted，finalizer 因而 Retire；不再用 boolean 记账。 */
type LeaseLifecycle =
  | {
      readonly _tag: "Open";
      readonly release: LeaseReleaseDecision;
    }
  | { readonly _tag: "Finalized" };

/** 一个 pair-owned physical plan 的按需复用池；实例始终独占借给单条 Attempt。 */
export class ReusableSandboxPool {
  private readonly entries: Entry[] = [];
  private readonly waiters: Array<() => void> = [];
  private creating = 0;
  private stopped = false;
  private readonly runtimeFailures: ReusableSandboxPoolRuntimeFailure[] = [];
  /** Provider 可观察的物理 owner；Group 池不能随首个未携入成员改用另一个 Eval ID。 */
  private readonly materializationOwnerId: string;
  /** 本次 Run 内的 Sandbox 编号计数器;淘汰的实例不让号,编号在结果里永远指向同一个实例。 */
  private created = 0;

  constructor(
    private readonly plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
    private readonly capacity: number,
    private readonly feedback: ScopedFeedback,
    private readonly setupContext: SandboxHookContext,
    private readonly runtimeServices: SandboxRuntimeServices = liveSandboxRuntimeServices,
    private readonly agent?: SandboxAgent,
    private readonly runTiming?: import("./timing.ts").RunTimingRecorder,
    materializationOwnerId?: string,
    private readonly resourceEnvelope?: SelectedResourceEnvelope,
    private readonly nextReuseSandboxNumber?: () => number,
  ) {
    this.materializationOwnerId = materializationOwnerId ?? plan.pair.evalId;
  }

  /** 把整座池登记进调用方 Scope；Invocation 中断与正常结束走同一条 stop finalizer。 */
  managed(): Effect.Effect<this, never, Scope.Scope> {
    return Effect.addFinalizer(() => this.stop()).pipe(Effect.as(this));
  }

  /**
   * @param attemptDeadlineMs 这条 Attempt 实际生效的超时上限(解析链见 runner/timeout.ts)。
   * `undefined` = 四层都没声明上限:请求的寿命只能覆盖收尾预留——Attempt 本身没有 deadline,
   * 池无从知道它要跑多久,也不替它编一个数。此后实例被 provider 按自己的 `lifetimeMs` 回收
   * 就是「不声明上限」的代价(两种时间的分界见 docs/feature/sandbox/reuse.md)。
   */
  acquire(
    attemptDeadlineMs: number | undefined,
    buildLocators: ReadonlyMap<BuildKey, JsonValue>,
  ): Effect.Effect<
    ReusableSandboxLease,
    Error | import("../sandbox/runtime.ts").SandboxRuntimeMaterializationError,
    Scope.Scope
  > {
    return Effect.gen(this, function* () {
      const minRemainingMs = (attemptDeadlineMs ?? 0) + CLEANUP_TIMEOUT_MS;
    /**
     * 借出期内单条命令的上限从这条线派生(`undefined` = 四层都没声明上限,照旧不发明一条线)。
     * 实例活得比 attempt 长,所以这条线必须**每次借出重设**——只在 create 时给一次的话,
     * 第二条 attempt 起就落回 provider SDK 的默认值(e2b 是 60 秒),实验声明的 timeoutMs
     * 完全不生效(见 sandbox/deadline.ts 的 `SandboxCommandDeadline`)。
     * 用 minRemainingMs 而不是 attemptDeadlineMs:归还时的分类账复位跑在同一条线下,
     * 不至于一还回来就撞一条已经过期的线。
     */
      const leaseDeadlineAt = attemptDeadlineMs === undefined ? undefined : () => Date.now() + minRemainingMs;
      for (;;) {
        if (this.stopped) return yield* Effect.fail(new Error("sandbox reuse pool has been stopped"));
        const ready = this.entries.find((entry) => entry.lifecycle._tag === "Idle");
        if (ready) {
        // 派发前确认:请求足以覆盖 Attempt deadline 与收尾预留的寿命。不 ready 就停掉这台、
        // 交给下一轮创建替代实例(替代实例在 create 里再确认一次,还不行就报错,不反复重建)。
          const lifetime = yield* externalPromise(() => ready.lifetime.ensureLifetime(minRemainingMs));
          // lifetime 检查是异步 provider I/O；其间 stop() 或另一条 release 可能已经退休这台。
          // 只有仍是 Idle 的实例才能真正借出，stop 后让下一轮在入口处统一失败。
          if (lifetime.ready && !this.stopped && ready.lifecycle._tag === "Idle") {
            return yield* this.lease(ready, leaseDeadlineAt?.());
          }
          if (this.stopped || ready.lifecycle._tag !== "Idle") continue;
          yield* this.retire(ready);
          continue;
        }
        if (this.entries.length + this.creating < this.capacity) {
          this.creating += 1;
          return yield* Effect.gen(this, function* () {
            const created = yield* this.create(minRemainingMs, leaseDeadlineAt?.(), buildLocators);
            this.entries.push(created);
            // stop 可能在物化期间开始。把刚创建的 entry 先纳入池，再由唯一 retire 路径关闭
            // 它自己的 Scope；绝不能把它借给已停止的池，也不能让 stop 在 creating=0 时漏掉它。
            if (this.stopped) {
              yield* this.retire(created);
              return yield* Effect.fail(new Error("sandbox reuse pool has been stopped"));
            }
            return yield* this.lease(created, leaseDeadlineAt?.());
          }).pipe(
            Effect.ensuring(Effect.sync(() => {
              this.creating -= 1;
              this.wake();
            })),
          );
        }
        yield* this.awaitWake();
      }
    });
  }

  stop(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      this.stopped = true;
      this.wake();
      // 已借出的 lease 仍在执行其 Attempt/cleanup；现在关闭 entry Scope 会把 Sandbox 在
      // 使用中 teardown。创建中的 entry 尚未进 entries，必须等它落入唯一 retire 路径。
      while (this.creating > 0 || this.entries.some((entry) => entry.lifecycle._tag === "Leased")) {
        yield* this.awaitWake();
      }
      yield* Effect.forEach([...this.entries], (entry) => this.retire(entry), {
        concurrency: "unbounded",
        discard: true,
      });
    });
  }

  /** Drained by the scheduler after the lease Scope sealed the prior result. */
  drainRuntimeFailures(): readonly ReusableSandboxPoolRuntimeFailure[] {
    return Object.freeze(this.runtimeFailures.splice(0));
  }

  private create(
    minRemainingMs: number,
    deadlineAt: number | undefined,
    buildLocators: ReadonlyMap<BuildKey, JsonValue>,
  ): Effect.Effect<Entry, Error | import("../sandbox/runtime.ts").SandboxRuntimeMaterializationError> {
    return Effect.gen(this, function* () {
      const capabilities = sandboxRuntimeCapabilities(this.plan);
      if (capabilities.reuse._tag === "Unsupported") {
        return yield* Effect.fail(new Error(
          `sandboxReuse is unsupported by provider ${JSON.stringify(capabilities.provider)}: ${capabilities.reuse.reason}`,
        ));
      }
      const deadline: SandboxRuntimeDeadline = deadlineAt === undefined
        ? { _tag: "Unlimited" }
        : { _tag: "Bounded", timeoutMs: Math.max(1, minRemainingMs - CLEANUP_TIMEOUT_MS), deadlineAt };
      const entryScope = yield* Scope.make();
      const materialized = yield* Scope.extend(materializeSandboxRunPlan({
        plan: this.plan,
        evalId: this.materializationOwnerId,
        deadline,
        feedback: this.feedback,
        signal: this.setupContext.signal,
        hookContext: this.setupContext,
        buildLocators,
        ...(this.agent !== undefined ? { agent: this.agent } : {}),
        ...(this.runTiming !== undefined ? { runTiming: this.runTiming } : {}),
        provisionSlot: { _tag: "Detached" },
        services: this.runtimeServices,
        release: { _tag: "Stop" },
      }), entryScope).pipe(
        Effect.onError((cause) => Scope.close(entryScope, Exit.failCause(cause))),
      );
      const sandbox = materialized.sandbox;
    // SandboxLayer setup has completed at this point. Plugin resources now
    // materialize into the same entry Scope, before the ledger establishes the
    // reset anchor. Scope LIFO releases resources before provider teardown.
      const resources = this.resourceEnvelope === undefined
      ? undefined
      : yield* Scope.extend(materializeSelectedPluginResources({
        envelope: this.resourceEnvelope,
        sandbox,
        signal: this.setupContext.signal,
        feedback: this.feedback,
        progress: this.setupContext.progress,
        fact: this.setupContext.fact,
        timing: (input: SandboxResourceTiming) => {
          if (this.runTiming === undefined) return;
          const durationMs = Math.max(0, input.durationMs);
          this.runTiming.child({
            key: input.key,
            label: input.label,
            startOffsetMs: Math.max(0, this.runTiming.offsetNow() - durationMs),
            durationMs,
            ...(input.failed ? { failed: true as const } : {}),
          });
        },
      }), entryScope).pipe(
        Effect.onError((cause) => Scope.close(entryScope, Exit.failCause(cause))),
      );
    // 能力只能来自 provider 实现:探不到就硬失败,没有通用记账兜底(见
    // docs/feature/sandbox/reuse.md「派发前确认」)。
    const lifetime = sandboxReuseCapability(sandbox);
    if (!lifetime) {
      yield* Scope.close(entryScope, Exit.void);
      return yield* Effect.fail(new Error(
        `sandboxReuse needs the "${capabilities.provider}" provider to confirm sandbox lifetime, but it does not implement ` +
          "ensureLifetime(minRemainingMs). Only a provider can prove the lifetime is set on its own backend; the runner " +
          "will not keep local books for it. Use a provider that implements it (docker / e2b / vercel), or drop sandboxReuse.",
      ));
    }
    const confirmed = yield* externalPromise(() => lifetime.ensureLifetime(minRemainingMs)).pipe(
      Effect.onError((cause) => Scope.close(entryScope, Exit.failCause(cause))),
    );
    if (!confirmed.ready) {
      yield* Scope.close(entryScope, Exit.void);
      return yield* Effect.fail(
        new Error(`sandboxReuse cannot prepare the "${capabilities.provider}" sandbox: ${confirmed.reason}`),
      );
    }
    const prepared = yield* Effect.gen(this, function* () {
      const ledger = yield* externalPromise(() => createChangeLedger(sandbox));
      // root 执行身份下题间 reset 永不安全(Agent 能读上一条 Attempt 留下的私有分类账对象);
      // 在实例进池、第一条 Attempt 派发前就拒绝,而不是等到归还时才在 resetToAnchor() 里
      // 暴露(那样首条 Attempt 已经跑完,失败还可能被静默退休吞掉)。
      if (ledger.rootExecutionIdentity) {
        return yield* Effect.fail(new Error(
          `sandboxReuse cannot reuse the "${capabilities.provider}" sandbox: the Agent's execution identity is root and could read private ledger objects left by earlier attempts; ` +
            "use a non-root execution user (declare USER in the image) or disable sandboxReuse",
        ));
      }
      // 建分类账会烧掉寿命:备好之后再确认一次。这次不够就报错收场——
      // 反复创建同样的替代实例只会反复烧同样的时间(见 reuse.md「派发前确认」)。
      const afterSetup = yield* externalPromise(() => lifetime.ensureLifetime(minRemainingMs));
      if (!afterSetup.ready) {
        return yield* Effect.fail(new Error(
          `sandboxReuse cannot use the "${capabilities.provider}" sandbox after baseline setup: ${afterSetup.reason}`,
        ));
      }
      const reuseSandbox = this.nextReuseSandboxNumber === undefined
        ? ++this.created
        : this.nextReuseSandboxNumber();
      return {
        sandbox,
        scope: entryScope,
        lifetime,
        ledger,
        ...(resources === undefined ? {} : { resources }),
        reuseSandbox,
        ordinal: 0,
        lifecycle: { _tag: "Idle" } satisfies EntryLifecycle,
      };
    }).pipe(Effect.onError((cause) => Scope.close(entryScope, Exit.failCause(cause))));
    return prepared;
    });
  }

  private lease(
    entry: Entry,
    deadlineAt: number | undefined,
  ): Effect.Effect<ReusableSandboxLease, never, Scope.Scope> {
    entry.lifecycle = { _tag: "Leased" };
    entry.ordinal += 1;
    applyCommandDeadline(entry.sandbox, deadlineAt);
    let lifecycle: LeaseLifecycle = {
      _tag: "Open",
      release: { _tag: "Uncommitted" },
    };
    const lease: ReusableSandboxLease = {
      sandbox: entry.sandbox,
      reuseSandbox: entry.reuseSandbox,
      reuseOrdinal: entry.ordinal,
      ...(entry.resources === undefined ? {} : { resources: entry.resources }),
      commit: (release) => Effect.sync(() => {
        if (lifecycle._tag !== "Open") return;
        lifecycle = { ...lifecycle, release: { _tag: "Committed", release } };
      }),
    };
    return Effect.addFinalizer(() => Effect.gen(this, function* () {
        if (lifecycle._tag === "Finalized") return;
        const settled = lifecycle;
        lifecycle = { _tag: "Finalized" };
        const release: ReusableLeaseRelease = settled.release._tag === "Committed"
          ? settled.release.release
          : { _tag: "Retire" };
        if (release._tag === "Retire") {
          yield* this.retire(entry);
        } else if (entry.lifecycle._tag !== "Retired") {
          const reset = yield* Effect.either(externalPromise(() => entry.ledger.resetToAnchor()));
          if (Either.isLeft(reset)) {
            this.runtimeFailures.push(Object.freeze({ stage: "sandbox.reset", error: reset.left }));
            this.feedback.diagnostic({
              code: "sandbox-reset-failed",
              level: "warning",
              message: `Sandbox #${entry.reuseSandbox} reset to anchor failed, retiring the instance: ${firstLine(formatThrown(reset.left))}`,
            });
            yield* this.retire(entry);
          } else {
            entry.lifecycle = { _tag: "Idle" };
          }
        }
        this.wake();
      })).pipe(Effect.as(lease));
  }

  /** 淘汰一台实例:停资源组并移出池——留在池里会占满容量,
   *  让后续 acquire 既等不到空闲实例、也创建不出替代实例(等待者永远醒不来)。 */
  private retire(entry: Entry): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      if (entry.lifecycle._tag === "Retired") return;
      entry.lifecycle = { _tag: "Retired" };
      const at = this.entries.indexOf(entry);
      if (at >= 0) this.entries.splice(at, 1);
      yield* Scope.close(entry.scope, Exit.void).pipe(
        Effect.catchAllCause((cause) => Effect.sync(() => this.feedback.diagnostic({
          code: "sandbox-stop-failed",
          level: "warning",
          message: `Sandbox reuse case finalizer failed: ${String(cause)}`,
        }))),
      );
      this.wake();
    });
  }

  private wake(): void {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  private awaitWake(): Effect.Effect<void> {
    return Effect.async<void>((resume) => {
      const wake = () => resume(Effect.void);
      this.waiters.push(wake);
      return Effect.sync(() => {
        const index = this.waiters.indexOf(wake);
        if (index >= 0) this.waiters.splice(index, 1);
      });
    });
  }
}

function externalPromise<Value>(run: () => Promise<Value>): Effect.Effect<Value, Error> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });
}
