import { applyCommandDeadline } from "../sandbox/deadline.ts";
import { sandboxReuseCapability } from "../sandbox/resolve.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import {
  materializeSandboxRunPlan,
  liveSandboxRuntimeServices,
  sandboxRuntimeCapabilities,
  type SandboxRuntimeDeadline,
  type SandboxRuntimeServices,
} from "../sandbox/runtime.ts";
import type { Sandbox, SandboxHookContext, SandboxReuseCapability, ScopedFeedback } from "../types.ts";
import { createChangeLedger, type ChangeLedger } from "./ledger.ts";
import { randomUUID } from "node:crypto";
import { createSandboxCommandTarget } from "../sandbox/operations.ts";
import { ExperimentStateWindow } from "../state/runtime.ts";
import type { PlannedExperimentState } from "../state/plan.ts";
import type { StateWindowRecord } from "../state/types.ts";
import { Effect, Either, Exit, Scope } from "effect";

const CLEANUP_RESERVE_MS = 30_000;

export interface ReusableSandboxLease {
  readonly sandbox: Sandbox;
  readonly reuseSandbox: number;
  readonly reuseOrdinal: number;
  readonly stateWindow: ReusableLeaseStateWindow;
  readonly lastPlannedUse: boolean;
  /** 提交本次 Attempt 的归还决策；Scope 退出负责实际 reset/retire，漏提交默认 Retire。 */
  commit(disposition: ReusableLeaseRelease): Effect.Effect<void>;
}

export type ReusableLeaseRelease =
  | { readonly _tag: "Reset" }
  | { readonly _tag: "Retire" };

export type ReusableLeaseStateWindow =
  | { readonly _tag: "Stateless" }
  | { readonly _tag: "Stateful"; readonly window: ExperimentStateWindow };

export type ReusablePoolStatePlan =
  | { readonly _tag: "Stateless" }
  | {
      readonly _tag: "Stateful";
      readonly plan: Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }>;
      readonly experimentId: string;
      readonly plannedUses: number;
    };

const STATELESS_POOL: ReusablePoolStatePlan = Object.freeze({ _tag: "Stateless" });

interface Entry {
  sandbox: Sandbox;
  scope: Scope.CloseableScope;
  /** provider 自己实现的寿命确认;没有这条能力的实例根本进不来(见 create)。 */
  lifetime: SandboxReuseCapability;
  ledger: ChangeLedger;
  reuseSandbox: number;
  ordinal: number;
  busy: boolean;
  dead: boolean;
  stateWindow: ReusableLeaseStateWindow;
}

/** 一个 pair-owned physical plan 的按需复用池；实例始终独占借给单条 Attempt。 */
export class ReusableSandboxPool {
  private readonly entries: Entry[] = [];
  private readonly waiters: Array<() => void> = [];
  private creating = 0;
  private stopped = false;
  /** 本次 Run 内的 Sandbox 编号计数器;淘汰的实例不让号,编号在结果里永远指向同一个实例。 */
  private created = 0;
  private remainingPlannedUses: number;
  private readonly stateRecords: StateWindowRecord[] = [];

  constructor(
    private readonly plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
    private readonly capacity: number,
    private readonly feedback: ScopedFeedback,
    private readonly setupContext: SandboxHookContext,
    private readonly statePlan: ReusablePoolStatePlan = STATELESS_POOL,
    private readonly runtimeServices: SandboxRuntimeServices = liveSandboxRuntimeServices,
  ) {
    this.remainingPlannedUses = statePlan._tag === "Stateful" ? statePlan.plannedUses : 0;
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
    buildLocators: ReadonlyMap<string, string> = new Map(),
  ): Effect.Effect<
    ReusableSandboxLease,
    Error | import("../sandbox/runtime.ts").SandboxRuntimeMaterializationError,
    Scope.Scope
  > {
    return Effect.gen(this, function* () {
      const minRemainingMs = (attemptDeadlineMs ?? 0) + CLEANUP_RESERVE_MS;
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
        const ready = this.entries.find((entry) => !entry.busy && !entry.dead);
        if (ready) {
        // 派发前确认:请求足以覆盖 Attempt deadline 与收尾预留的寿命。不 ready 就停掉这台、
        // 交给下一轮创建替代实例(替代实例在 create 里再确认一次,还不行就报错,不反复重建)。
          const lifetime = yield* externalPromise(() => ready.lifetime.ensureLifetime(minRemainingMs));
          if (lifetime.ready) return yield* this.lease(ready, leaseDeadlineAt?.());
          yield* this.retire(ready);
          continue;
        }
        if (this.entries.length + this.creating < this.capacity) {
          this.creating += 1;
          const created = yield* this.create(minRemainingMs, leaseDeadlineAt?.(), buildLocators).pipe(
            Effect.ensuring(Effect.sync(() => {
              this.creating -= 1;
              this.wake();
            })),
          );
          this.entries.push(created);
          return yield* this.lease(created, leaseDeadlineAt?.());
        }
        yield* Effect.async<void>((resume) => {
          const wake = () => resume(Effect.void);
          this.waiters.push(wake);
          return Effect.sync(() => {
            const index = this.waiters.indexOf(wake);
            if (index >= 0) this.waiters.splice(index, 1);
          });
        });
      }
    });
  }

  stop(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      this.stopped = true;
      this.wake();
      yield* Effect.forEach([...this.entries], (entry) => this.retire(entry), {
        concurrency: "unbounded",
        discard: true,
      });
    });
  }

  stateWindowRecords(): readonly StateWindowRecord[] {
    return Object.freeze([...this.stateRecords]);
  }

  private create(
    minRemainingMs: number,
    deadlineAt: number | undefined,
    buildLocators: ReadonlyMap<string, string>,
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
        : { _tag: "Bounded", timeoutMs: Math.max(1, minRemainingMs - CLEANUP_RESERVE_MS), deadlineAt };
      const entryScope = yield* Scope.make();
      const materialized = yield* Scope.extend(materializeSandboxRunPlan({
        plan: this.plan,
        evalId: this.plan.pair.evalId,
        deadline,
        feedback: this.feedback,
        signal: this.setupContext.signal,
        buildLocators,
        provisionSlot: { _tag: "Detached" },
        services: this.runtimeServices,
        release: { _tag: "Stop" },
      }), entryScope).pipe(
        Effect.onError((cause) => Scope.close(entryScope, Exit.failCause(cause))),
      );
      const sandbox = materialized.sandbox;
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
      // 建分类账会烧掉寿命:备好之后再确认一次。这次不够就报错收场——
      // 反复创建同样的替代实例只会反复烧同样的时间(见 reuse.md「派发前确认」)。
      const afterSetup = yield* externalPromise(() => lifetime.ensureLifetime(minRemainingMs));
      if (!afterSetup.ready) {
        return yield* Effect.fail(new Error(
          `sandboxReuse cannot use the "${capabilities.provider}" sandbox after baseline setup: ${afterSetup.reason}`,
        ));
      }
      this.created += 1;
      const stateWindow: ReusableLeaseStateWindow = this.statePlan._tag === "Stateless"
        ? { _tag: "Stateless" }
        : {
            _tag: "Stateful",
            window: yield* ExperimentStateWindow.make(
              this.statePlan.plan,
              this.statePlan.experimentId,
              randomUUID(),
            ),
          };
      return {
        sandbox,
        scope: entryScope,
        lifetime,
        ledger,
        reuseSandbox: this.created,
        ordinal: 0,
        busy: false,
        dead: false,
        stateWindow,
      };
    }).pipe(Effect.onError((cause) => Scope.close(entryScope, Exit.failCause(cause))));
    return prepared;
    });
  }

  private lease(
    entry: Entry,
    deadlineAt: number | undefined,
  ): Effect.Effect<ReusableSandboxLease, never, Scope.Scope> {
    entry.busy = true;
    entry.ordinal += 1;
    applyCommandDeadline(entry.sandbox, deadlineAt);
    if (this.statePlan._tag === "Stateful") this.remainingPlannedUses = Math.max(0, this.remainingPlannedUses - 1);
    const lastPlannedUse = this.statePlan._tag === "Stateful" && this.remainingPlannedUses === 0;
    let release: ReusableLeaseRelease = { _tag: "Retire" };
    let finalized = false;
    const lease: ReusableSandboxLease = {
      sandbox: entry.sandbox,
      reuseSandbox: entry.reuseSandbox,
      reuseOrdinal: entry.ordinal,
      stateWindow: entry.stateWindow,
      lastPlannedUse,
      commit: (disposition) => Effect.sync(() => {
        if (!finalized) release = disposition;
      }),
    };
    return Effect.addFinalizer(() => Effect.gen(this, function* () {
        if (finalized) return;
        finalized = true;
        if (release._tag === "Retire") {
          yield* this.retire(entry);
        } else if (!entry.dead) {
          const reset = yield* Effect.either(externalPromise(() => entry.ledger.resetToAnchor()));
          if (Either.isLeft(reset)) yield* this.retire(entry);
        }
        entry.busy = false;
        this.wake();
      })).pipe(Effect.as(lease));
  }

  /** 淘汰一台实例:收束 State、停资源组并移出池——留在池里会占满容量,
   *  让后续 acquire 既等不到空闲实例、也创建不出替代实例(等待者永远醒不来)。 */
  private retire(entry: Entry): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      if (entry.dead) return;
      entry.dead = true;
      const at = this.entries.indexOf(entry);
      if (at >= 0) this.entries.splice(at, 1);
      if (entry.stateWindow._tag === "Stateful") {
        let snapshot = yield* entry.stateWindow.window.snapshot();
        if (snapshot._tag === "Open") {
          yield* Effect.either(entry.stateWindow.window.finalize({
              sandbox: createSandboxCommandTarget(entry.sandbox),
              progress: (input) => this.feedback.progress(input),
              diagnostic: (input) => this.feedback.diagnostic({ ...input, level: "warning" }),
              fact: this.setupContext.fact,
            }, {
              completion: { _tag: "VerdictNotPassed", verdict: "errored" },
              budget: { _tag: "Bounded", timeoutMs: CLEANUP_RESERVE_MS },
            }));
        }
        snapshot = yield* entry.stateWindow.window.snapshot();
        if (snapshot._tag === "Finalized" && !this.stateRecords.some((item) => item.windowId === snapshot.record.windowId)) {
          this.stateRecords.push(snapshot.record);
        }
      }
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
}

function externalPromise<Value>(run: () => Promise<Value>): Effect.Effect<Value, Error> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });
}
