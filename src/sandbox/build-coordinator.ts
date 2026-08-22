// Run 级构建协调器:携带规划后只为仍需 fresh 的 BuildKey 工作。
// single-flight、独立并发、逐 key timeout、全局准备上限、abort/cancel;
// 写 sandbox.build timings 与 sandboxBuilds provenance;失败按依赖集合扇出。
// 契约单源:docs/feature/sandbox/case.md「Run 级构建协调」;
// 落盘形状:docs/feature/record/architecture.md「sandboxBuilds」。
// 内部是 Effect 协调:逐 key 结算用 Deferred、整批收工用 Fiber 观察、退避用 Clock.sleep、
// 并发闸用 Semaphore;公开 RunningSandboxBuilds 保持 Promise ABI,只在方法边界 runPromise。

import { createHash, randomUUID } from "node:crypto";
import { Deferred, Duration, Effect, Exit, Fiber, FiberId, Random } from "effect";
import type { JsonValue } from "../shared/types.ts";
import type { RunTimingRecorder } from "../runner/timing.ts";
import type { SandboxBuildRecord, TimingActivity } from "../runner/types.ts";
import { classifyProvisionErrorFallback, isRetryableProvisionError } from "./errors.ts";
import type { BuildKey } from "./identity.ts";

/** Run 级开放 activity key;与 Record 契约同名。 */
export const SANDBOX_BUILD_ACTIVITY = "sandbox.build" as const;

declare const MaterializationScopeIdBrand: unique symbol;
export type MaterializationScopeId = string & { readonly [MaterializationScopeIdBrand]: true };
declare const SandboxBuildRefBrand: unique symbol;
export type SandboxBuildRef = string & { readonly [SandboxBuildRefBrand]: true };

export function materializationScopeId(input: {
  readonly providerFamily: string;
  readonly authorityFingerprint: string;
  readonly materializationProtocolVersion: number;
}): MaterializationScopeId {
  return createHash("sha256").update(JSON.stringify([
    input.providerFamily,
    input.authorityFingerprint,
    input.materializationProtocolVersion,
  ])).digest("hex") as MaterializationScopeId;
}

export function sandboxBuildRef(scopeId: MaterializationScopeId, buildKey: BuildKey): SandboxBuildRef {
  return createHash("sha256").update(`${scopeId}\0${buildKey}`).digest("hex") as SandboxBuildRef;
}

/** 一条待协调的构建工作(同 BuildKey 只保留第一次出现的 inputs / provider)。 */
export interface SandboxBuildWork {
  readonly ref: SandboxBuildRef;
  readonly scopeId: MaterializationScopeId;
  readonly buildKey: BuildKey;
  readonly provider: string;
  /** 解析后的构建输入投影;不含凭据值。 */
  readonly inputs: JsonValue;
  /** 有界人读标签;省略时用 BuildKey 短前缀。 */
  readonly label?: string;
}

export interface SandboxBuildUseHandle {
  readonly locator: JsonValue;
  release(): Promise<void> | void;
}

export interface SandboxBuildArtifactSource {
  readonly locator: JsonValue;
  readonly source: "cache" | "build";
  acquireUse(signal: AbortSignal): Promise<SandboxBuildUseHandle>;
  release(): Promise<void> | void;
}

export type SandboxBuildLookup =
  | { readonly _tag: "Hit"; readonly source: SandboxBuildArtifactSource }
  | { readonly _tag: "Miss" }
  | { readonly _tag: "Unsupported" };

/** provider 侧 cache 查询与真实构建。 */
export interface SandboxBuildProvider {
  /** 查 provider 原生 cache / 本地 build registry;命中返回 locator。 */
  lookup(work: SandboxBuildWork, signal: AbortSignal): Promise<SandboxBuildLookup>;
  /** cache miss 时调用原生构建 API。 */
  build(work: SandboxBuildWork, ctx: SandboxBuildExecutionContext): Promise<SandboxBuildArtifactSource>;
  /** 可选:Invocation abort / timeout 时取消远端 build。 */
  cancel?(work: SandboxBuildWork): Promise<void>;
}

/** 构建执行上下文:子 activity 挂在当前 sandbox.build 节点下。 */
export interface SandboxBuildExecutionContext {
  readonly operationId: string;
  readonly signal: AbortSignal;
  readonly timing: RunTimingRecorder;
  readonly parent: TimingActivity;
}

export interface PrepareSandboxBuildsOptions {
  readonly timing: RunTimingRecorder;
  readonly provider: SandboxBuildProvider;
  /** 同时 in-flight 的不同 BuildKey 上限;默认 2。不占 attempt 并发位。 */
  readonly maxConcurrency?: number;
  /** 逐 BuildKey 的 timeout(ms);省略 = 无逐 key 上限。 */
  readonly buildTimeoutMs?: number;
  /** 整段准备的全局墙钟上限(ms);省略 = 无全局上限。 */
  readonly prepareBudgetMs?: number;
  /** Invocation abort(Ctrl+C)。 */
  readonly signal?: AbortSignal;
  /**
   * 每个 BuildKey 真正开始 / 结束时回调一次(有界起止事件)。
   * 供 live feedback 投影为运行级 active 行 / 非 TTY 永久事件;不改变协调语义。
   */
  readonly onActivity?: (event: SandboxBuildActivityEvent) => void;
  /** 瞬时构建失败的退避重试上限(含首次尝试);默认 3。 */
  readonly buildAttempts?: number;
  /** 退避基数(ms),第 n 次重试睡 base × 2^n × 抖动;默认 1000。 */
  readonly buildRetryBaseMs?: number;
}

/** 构建协调器对外的有界 activity 事件(与 Run feedback 的 run-activity 字段对齐)。 */
export type SandboxBuildActivityEvent =
  | {
      status: "started";
      ref: SandboxBuildRef;
      buildKey: BuildKey;
      id: string;
      key: typeof SANDBOX_BUILD_ACTIVITY;
      label: string;
    }
  | {
      status: "done" | "failed";
      outcome: SandboxBuildRecord["status"];
      ref: SandboxBuildRef;
      buildKey: BuildKey;
      id: string;
      key: typeof SANDBOX_BUILD_ACTIVITY;
      label: string;
      durationMs: number;
    };

export interface SandboxBuildFailure {
  readonly ref: SandboxBuildRef;
  readonly buildKey: BuildKey;
  readonly timingNodeId: string;
  readonly status: "failed" | "cancelled";
  readonly error: NonNullable<SandboxBuildRecord["error"]>;
}

export interface SandboxBuildPreparation {
  /** 成功(hit / built)的 BuildKey → locator。 */
  readonly sources: ReadonlyMap<SandboxBuildRef, SandboxBuildArtifactSource>;
  /** 实际查询或构建过的每条 provenance(不含完全携带、从未过问的 key)。 */
  readonly records: readonly SandboxBuildRecord[];
  /** 失败或取消的 BuildKey → 共用同一 Run timing origin 的错误。 */
  readonly failures: ReadonlyMap<SandboxBuildRef, SandboxBuildFailure>;
}

/** 进行中的 Run 级共享准备:逐 BuildKey 放行,依赖者只等自己引用的那几个 key。 */
export interface RunningSandboxBuilds {
  /** 已结算 key 的实时视图(随构建推进增补,不等整批收工)。 */
  readonly sources: ReadonlyMap<SandboxBuildRef, SandboxBuildArtifactSource>;
  /** 已失败 / 已取消 key 的实时视图。 */
  readonly failures: ReadonlyMap<SandboxBuildRef, SandboxBuildFailure>;
  /** 等某个 BuildKey 结算;不在本次协调范围内的 key 立即返回。 */
  settled(ref: SandboxBuildRef): Promise<void>;
  /** 全部 key 结算后的汇总(provenance 在这里齐全)。 */
  readonly done: Promise<SandboxBuildPreparation>;
}

/**
 * 对仍需 fresh 的 BuildKey 做 Run 级共享准备,等全部 key 结算。
 * 调用方负责先做携带规划、只传入未携带 attempt 引用的 key;本函数不为「查看旧结果」造假 provenance。
 */
export async function prepareSandboxBuilds(
  works: readonly SandboxBuildWork[],
  opts: PrepareSandboxBuildsOptions,
): Promise<SandboxBuildPreparation> {
  return startSandboxBuilds(works, opts).done;
}

/**
 * 启动 Run 级共享准备并立刻返回句柄:调用方按 BuildKey 逐个等待,
 * 只依赖已就绪 key 的 attempt 不被同批最慢的那个构建挡住(见 case.md「Run 级构建协调」第 4 条)。
 */
export function startSandboxBuilds(
  works: readonly SandboxBuildWork[],
  opts: PrepareSandboxBuildsOptions,
): RunningSandboxBuilds {
  const unique = dedupeWorks(works);
  if (unique.length === 0) {
    const empty: SandboxBuildPreparation = { sources: new Map(), records: [], failures: new Map() };
    return {
      sources: empty.sources,
      failures: empty.failures,
      async settled() {},
      done: Promise.resolve(empty),
    };
  }

  const maxConcurrency = Math.max(1, opts.maxConcurrency ?? 2);
  const sources = new Map<SandboxBuildRef, SandboxBuildArtifactSource>();
  const records: SandboxBuildRecord[] = [];
  const failures = new Map<SandboxBuildRef, SandboxBuildFailure>();

  const prepareSignal = combineSignals([
    opts.signal,
    opts.prepareBudgetMs !== undefined ? AbortSignal.timeout(opts.prepareBudgetMs) : undefined,
  ]);

  // 逐 key 的结算 Deferred:key 一结算就 settle,依赖它的 attempt 当场放行,
  // 不等同批其它 key(single-flight 仍靠这张表,同 key 的第二个 work 复用同一条)。
  // 在方法边界同步创建,settled() 在任意时刻调用都拿到同一结果;
  // Deferred 结算后状态保持,迟到等待方同样立即放行。
  const perKey = new Map<SandboxBuildRef, Deferred.Deferred<void, never>>();
  for (const work of unique) {
    perKey.set(work.ref, Deferred.unsafeMake(FiberId.unsafeMake()));
  }

  const ctx = {
    timing: opts.timing,
    provider: opts.provider,
    buildTimeoutMs: opts.buildTimeoutMs,
    signal: prepareSignal,
    sources,
    records,
    failures,
    onActivity: opts.onActivity,
    buildAttempts: Math.max(1, opts.buildAttempts ?? DEFAULT_BUILD_ATTEMPTS),
    buildRetryBaseMs: Math.max(0, opts.buildRetryBaseMs ?? DEFAULT_BUILD_RETRY_BASE_MS),
  };

  // 整段准备是一个 Effect 程序:每 key 一条 gate 保护的 fiber,结算挂在 ensuring 上
  // (失败/中断同样放行等待方);收尾逐 fiber 观察 exit,先到先报缺陷——与 Promise.all
  // 的失败传播一致,且观察不打断兄弟 fiber,一条出事后其余 key 照常结算。
  const coordination = Effect.gen(function* () {
    const gate = yield* Effect.makeSemaphore(maxConcurrency);
    const fibers = yield* Effect.forEach(unique, (work) =>
      Effect.fork(
        gate.withPermits(1)(prepareOne(work, ctx)).pipe(
          Effect.ensuring(Effect.asVoid(Deferred.succeed(perKey.get(work.ref)!, undefined))),
        ),
      ));
    const exits = yield* Effect.forEach(fibers, Fiber.await, { concurrency: "unbounded" });
    const failed = exits.find(Exit.isFailure);
    if (failed !== undefined && Exit.isFailure(failed)) return yield* Effect.failCause(failed.cause);
    return { sources, records, failures } satisfies SandboxBuildPreparation;
  });
  // 边界:唯一一次把 Effect 驱动进公开 Promise ABI。
  const done = Effect.runPromise(coordination);

  return {
    sources,
    failures,
    async settled(ref) {
      const deferred = perKey.get(ref);
      if (deferred === undefined) return;
      await Effect.runPromise(Deferred.await(deferred));
    },
    done,
  };
}

/**
 * 从 fresh attempt 依赖表扇出构建失败 → AttemptError 形状所需字段。
 * 同一 BuildKey 的所有依赖者共用同一个 timingNodeId。
 */
export function buildFailureOrigin(
  failure: SandboxBuildFailure,
): { code: string; message: string; timingNodeId: string; cause?: SandboxBuildFailure["error"]["cause"] } {
  return {
    code: failure.error.code,
    message: failure.error.message,
    timingNodeId: failure.timingNodeId,
    ...(failure.error.cause !== undefined ? { cause: failure.error.cause } : {}),
  };
}

function dedupeWorks(works: readonly SandboxBuildWork[]): SandboxBuildWork[] {
  const seen = new Map<SandboxBuildRef, SandboxBuildWork>();
  for (const work of works) {
    if (!seen.has(work.ref)) seen.set(work.ref, work);
  }
  return [...seen.values()];
}

function prepareOne(
  work: SandboxBuildWork,
  ctx: {
    timing: RunTimingRecorder;
    provider: SandboxBuildProvider;
    buildTimeoutMs: number | undefined;
    signal: AbortSignal;
    sources: Map<SandboxBuildRef, SandboxBuildArtifactSource>;
    records: SandboxBuildRecord[];
    failures: Map<SandboxBuildRef, SandboxBuildFailure>;
    onActivity?: (event: SandboxBuildActivityEvent) => void;
    buildAttempts: number;
    buildRetryBaseMs: number;
  },
  // 失败通道来自 provider 边界 tryPromise 的 unknown;gen 内部的实际错误都收进 finish 落账,
  // 不会逃出这个 Effect(只有缺陷会通过 defect 通道冒泡)。
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const label = work.label ?? `build ${work.buildKey.slice(0, 12)}`;
    const startOffsetMs = ctx.timing.offsetNow();
    const parent = ctx.timing.child({
      key: SANDBOX_BUILD_ACTIVITY,
      label,
      startOffsetMs,
      durationMs: 0,
    });
    ctx.onActivity?.({
      status: "started",
      ref: work.ref,
      buildKey: work.buildKey,
      id: parent.id,
      key: SANDBOX_BUILD_ACTIVITY,
      label,
    });

    const keySignal = combineSignals([
      ctx.signal,
      ctx.buildTimeoutMs !== undefined ? AbortSignal.timeout(ctx.buildTimeoutMs) : undefined,
    ]);

    const finish = (status: SandboxBuildRecord["status"], source?: SandboxBuildArtifactSource, error?: SandboxBuildRecord["error"]) => {
      parent.durationMs = Math.max(0, ctx.timing.offsetNow() - startOffsetMs);
      if (status === "failed" || status === "cancelled") parent.failed = true;
      const record: SandboxBuildRecord = {
        buildKey: work.buildKey,
        provider: work.provider,
        status,
        timingNodeId: parent.id,
        inputs: work.inputs,
        ...(source !== undefined ? { locator: source.locator } : {}),
        ...(error !== undefined ? { error } : {}),
      };
      ctx.records.push(record);
      if (source !== undefined && (status === "hit" || status === "built")) {
        ctx.sources.set(work.ref, source);
      }
      if (error !== undefined && (status === "failed" || status === "cancelled")) {
        ctx.failures.set(work.ref, {
          ref: work.ref,
          buildKey: work.buildKey,
          timingNodeId: parent.id,
          status,
          error,
        });
      }
      ctx.onActivity?.({
        status: status === "failed" || status === "cancelled" ? "failed" : "done",
        ref: work.ref,
        outcome: status,
        buildKey: work.buildKey,
        id: parent.id,
        key: SANDBOX_BUILD_ACTIVITY,
        label,
        durationMs: parent.durationMs,
      });
    };

    if (keySignal.aborted) {
      finish("cancelled", undefined, abortError(keySignal, work.buildKey));
      return;
    }

    const finishFailure = (e: unknown): Effect.Effect<void> => Effect.gen(function* () {
      if (keySignal.aborted || isAbortError(e)) {
        const cancel = ctx.provider.cancel;
        if (cancel !== undefined) {
          yield* Effect.tryPromise({
            try: () => cancel(work),
            catch: () => undefined,
          }).pipe(Effect.ignore);
        }
        finish("cancelled", undefined, abortError(keySignal, work.buildKey, e));
        return;
      }
      finish("failed", undefined, failedError(work.buildKey, e));
    });

    const lookup = yield* Effect.either(Effect.tryPromise({
      try: () => ctx.provider.lookup(work, keySignal),
      catch: (error) => error,
    }));
    if (lookup._tag === "Left") return yield* finishFailure(lookup.left);
    if (lookup.right._tag === "Hit") {
      finish("hit", lookup.right.source);
      return;
    }

    // 瞬时构建失败(基线镜像拉取限流、传输层中断)退避重试:构建产物是镜像与 template,
    // 没有计费实例的泄漏面,歧义类同样可重试(case.md「Run 级构建协调」第 5 条)。
    const operationId = randomUUID();
    const build = (attempt: number): Effect.Effect<SandboxBuildArtifactSource, unknown> =>
      Effect.tryPromise({
        try: () => ctx.provider.build(work, {
          operationId,
          signal: keySignal,
          timing: ctx.timing,
          parent,
        }),
        catch: (error) => error,
      }).pipe(Effect.catchAll((error) => {
        const last = attempt >= ctx.buildAttempts - 1;
        if (last || keySignal.aborted || isAbortError(error) || !isTransientBuildError(error)) {
          return Effect.fail(error);
        }
        return Random.next.pipe(
          Effect.map((jitter) => backoffDelay(ctx.buildRetryBaseMs, attempt, jitter)),
          Effect.flatMap((delayMs) => sleep(delayMs, keySignal)),
          Effect.flatMap(() => keySignal.aborted ? Effect.fail(error) : build(attempt + 1)),
        );
      }));
    const built = yield* Effect.either(build(0));
    if (built._tag === "Left") return yield* finishFailure(built.left);
    finish("built", built.right);
  });
}

/** 首次尝试 + 2 次重试:与 provisioning 同一种「封顶次数」纪律,构建单次耗时更长所以更浅。 */
const DEFAULT_BUILD_ATTEMPTS = 3;
const DEFAULT_BUILD_RETRY_BASE_MS = 1000;

/** 指数退避 + 全抖动(0.5x~1.5x),避免同一批被限流的构建同时醒来再次撞限流。 */
function backoffDelay(baseMs: number, attempt: number, jitter: number): number {
  return baseMs * 2 ** attempt * (0.5 + jitter);
}

/** 退避睡眠:Clock 驱动的 Effect.sleep(TestClock 可验证时序),abort 时提前放行。 */
function sleep(ms: number, signal: AbortSignal): Effect.Effect<void, never> {
  if (ms <= 0) return Effect.void;
  const timer = Effect.sleep(Duration.millis(ms));
  const abort = Effect.async<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const onAbort = () => resume(Effect.void);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });
  return Effect.raceFirst(timer, abort);
}

/**
 * 构建失败的性质分类:瞬时才重试。
 * 先过与 provisioning 共用的保守瞬时分类器,再补 builder CLI 自己的文案形态——
 * registry 限流、拉取中途 EOF、TLS / IO 超时都出现在 `docker compose build` 的 stderr 里,
 * 它们不带 status code,只有文案。
 */
function isTransientBuildError(e: unknown): boolean {
  if (isRetryableProvisionError(classifyProvisionErrorFallback(e))) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /toomanyrequests|unexpected EOF|i\/o timeout|TLS handshake timeout|failed to do request|connection reset by peer|temporary failure in name resolution|failed to copy: httpReadSeeker|EOF$/im.test(
    message,
  );
}

function abortError(signal: AbortSignal, buildKey: BuildKey, cause?: unknown): NonNullable<SandboxBuildRecord["error"]> {
  const timedOut = isTimeoutReason(signal.reason);
  const code = timedOut ? "sandbox-build-timeout" : "sandbox-build-cancelled";
  const message = timedOut
    ? `sandbox build timed out for BuildKey ${buildKey.slice(0, 12)}…`
    : `sandbox build cancelled for BuildKey ${buildKey.slice(0, 12)}…`;
  return {
    code,
    message,
    ...(cause !== undefined ? { cause: causeSummary(cause) } : {}),
  };
}

function isTimeoutReason(reason: unknown): boolean {
  if (reason === undefined || reason === null) return false;
  if (typeof DOMException !== "undefined" && reason instanceof DOMException && reason.name === "TimeoutError") {
    return true;
  }
  return reason instanceof Error && reason.name === "TimeoutError";
}

function failedError(buildKey: BuildKey, e: unknown): NonNullable<SandboxBuildRecord["error"]> {
  return {
    code: "sandbox-build-failed",
    message: e instanceof Error ? e.message : `sandbox build failed for BuildKey ${buildKey.slice(0, 12)}…`,
    cause: causeSummary(e),
  };
}

function causeSummary(e: unknown): { name?: string; code?: string; message: string } {
  if (e instanceof Error) {
    const withCode = e as Error & { code?: unknown };
    const code = typeof withCode.code === "string" ? withCode.code : undefined;
    return {
      name: e.name,
      ...(code !== undefined ? { code } : {}),
      message: e.message,
    };
  }
  return { message: String(e) };
}

function isAbortError(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  if (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") return true;
  return false;
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => s !== undefined);
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0]!;
  return AbortSignal.any(active);
}
