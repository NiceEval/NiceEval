// Run 级构建协调器:携带规划后只为仍需 fresh 的 BuildKey 工作。
// single-flight、独立并发、逐 key timeout、全局准备上限、abort/cancel;
// 写 sandbox.build timings 与 sandboxBuilds provenance;失败按依赖集合扇出。
// 契约单源:docs/feature/sandbox/case.md「Run 级构建协调」;
// 落盘形状:docs/feature/record/architecture.md「sandboxBuilds」。

import type { JsonValue } from "../shared/types.ts";
import type { RunTimingRecorder } from "../runner/timing.ts";
import type { SandboxBuildRecord, TimingActivity } from "../runner/types.ts";
import type { BuildKey } from "./identity.ts";

/** Run 级开放 activity key;与 Record 契约同名。 */
export const SANDBOX_BUILD_ACTIVITY = "sandbox.build" as const;

/** 一条待协调的构建工作(同 BuildKey 只保留第一次出现的 inputs / provider)。 */
export interface SandboxBuildWork {
  readonly buildKey: BuildKey;
  readonly provider: string;
  /** 解析后的构建输入投影;不含凭据值。 */
  readonly inputs: JsonValue;
  /** 有界人读标签;省略时用 BuildKey 短前缀。 */
  readonly label?: string;
}

/** provider 侧 cache 查询与真实构建。 */
export interface SandboxBuildProvider {
  /** 查 provider 原生 cache / 本地 build registry;命中返回 locator。 */
  lookup(work: SandboxBuildWork, signal: AbortSignal): Promise<JsonValue | undefined>;
  /** cache miss 时调用原生构建 API。 */
  build(work: SandboxBuildWork, ctx: SandboxBuildExecutionContext): Promise<JsonValue>;
  /** 可选:Invocation abort / timeout 时取消远端 build。 */
  cancel?(work: SandboxBuildWork): Promise<void>;
}

/** 构建执行上下文:子 activity 挂在当前 sandbox.build 节点下。 */
export interface SandboxBuildExecutionContext {
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
}

/** 构建协调器对外的有界 activity 事件(与 Run feedback 的 run-activity 字段对齐)。 */
export type SandboxBuildActivityEvent =
  | {
      status: "started";
      buildKey: BuildKey;
      id: string;
      key: typeof SANDBOX_BUILD_ACTIVITY;
      label: string;
    }
  | {
      status: "done" | "failed";
      buildKey: BuildKey;
      id: string;
      key: typeof SANDBOX_BUILD_ACTIVITY;
      label: string;
      durationMs: number;
    };

export interface SandboxBuildFailure {
  readonly buildKey: BuildKey;
  readonly timingNodeId: string;
  readonly status: "failed" | "cancelled";
  readonly error: NonNullable<SandboxBuildRecord["error"]>;
}

export interface SandboxBuildPreparation {
  /** 成功(hit / built)的 BuildKey → locator。 */
  readonly locators: ReadonlyMap<BuildKey, JsonValue>;
  /** 实际查询或构建过的每条 provenance(不含完全携带、从未过问的 key)。 */
  readonly records: readonly SandboxBuildRecord[];
  /** 失败或取消的 BuildKey → 共用同一 Run timing origin 的错误。 */
  readonly failures: ReadonlyMap<BuildKey, SandboxBuildFailure>;
}

/**
 * 对仍需 fresh 的 BuildKey 做 Run 级共享准备。
 * 调用方负责先做携带规划、只传入未携带 attempt 引用的 key;本函数不为「查看旧结果」造假 provenance。
 */
export async function prepareSandboxBuilds(
  works: readonly SandboxBuildWork[],
  opts: PrepareSandboxBuildsOptions,
): Promise<SandboxBuildPreparation> {
  const unique = dedupeWorks(works);
  if (unique.length === 0) {
    return { locators: new Map(), records: [], failures: new Map() };
  }

  const maxConcurrency = Math.max(1, opts.maxConcurrency ?? 2);
  const locators = new Map<BuildKey, JsonValue>();
  const records: SandboxBuildRecord[] = [];
  const failures = new Map<BuildKey, SandboxBuildFailure>();

  const prepareSignal = combineSignals([
    opts.signal,
    opts.prepareBudgetMs !== undefined ? AbortSignal.timeout(opts.prepareBudgetMs) : undefined,
  ]);

  const gate = createConcurrencyGate(maxConcurrency);
  const inflight = new Map<BuildKey, Promise<void>>();

  const runOne = async (work: SandboxBuildWork): Promise<void> => {
    await gate.acquire();
    try {
      await prepareOne(work, {
        timing: opts.timing,
        provider: opts.provider,
        buildTimeoutMs: opts.buildTimeoutMs,
        signal: prepareSignal,
        locators,
        records,
        failures,
        onActivity: opts.onActivity,
      });
    } finally {
      gate.release();
    }
  };

  await Promise.all(
    unique.map((work) => {
      const pending = inflight.get(work.buildKey);
      if (pending) return pending;
      const promise = runOne(work).finally(() => {
        inflight.delete(work.buildKey);
      });
      inflight.set(work.buildKey, promise);
      return promise;
    }),
  );

  return { locators, records, failures };
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
  const seen = new Map<BuildKey, SandboxBuildWork>();
  for (const work of works) {
    if (!seen.has(work.buildKey)) seen.set(work.buildKey, work);
  }
  return [...seen.values()];
}

async function prepareOne(
  work: SandboxBuildWork,
  ctx: {
    timing: RunTimingRecorder;
    provider: SandboxBuildProvider;
    buildTimeoutMs: number | undefined;
    signal: AbortSignal;
    locators: Map<BuildKey, JsonValue>;
    records: SandboxBuildRecord[];
    failures: Map<BuildKey, SandboxBuildFailure>;
    onActivity?: (event: SandboxBuildActivityEvent) => void;
  },
): Promise<void> {
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
    buildKey: work.buildKey,
    id: parent.id,
    key: SANDBOX_BUILD_ACTIVITY,
    label,
  });

  const keySignal = combineSignals([
    ctx.signal,
    ctx.buildTimeoutMs !== undefined ? AbortSignal.timeout(ctx.buildTimeoutMs) : undefined,
  ]);

  const finish = (status: SandboxBuildRecord["status"], locator?: JsonValue, error?: SandboxBuildRecord["error"]) => {
    parent.durationMs = Math.max(0, ctx.timing.offsetNow() - startOffsetMs);
    if (status === "failed" || status === "cancelled") parent.failed = true;
    const record: SandboxBuildRecord = {
      buildKey: work.buildKey,
      provider: work.provider,
      status,
      timingNodeId: parent.id,
      inputs: work.inputs,
      ...(locator !== undefined ? { locator } : {}),
      ...(error !== undefined ? { error } : {}),
    };
    ctx.records.push(record);
    if (locator !== undefined && (status === "hit" || status === "built")) {
      ctx.locators.set(work.buildKey, locator);
    }
    if (error !== undefined && (status === "failed" || status === "cancelled")) {
      ctx.failures.set(work.buildKey, {
        buildKey: work.buildKey,
        timingNodeId: parent.id,
        status,
        error,
      });
    }
    ctx.onActivity?.({
      status: status === "failed" || status === "cancelled" ? "failed" : "done",
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

  try {
    const hit = await ctx.provider.lookup(work, keySignal);
    if (hit !== undefined) {
      finish("hit", hit);
      return;
    }

    const locator = await ctx.provider.build(work, {
      signal: keySignal,
      timing: ctx.timing,
      parent,
    });
    finish("built", locator);
  } catch (e) {
    if (keySignal.aborted || isAbortError(e)) {
      try {
        await ctx.provider.cancel?.(work);
      } catch {
        // 取消失败不掩盖原 abort;远端残留由后续 registry 认领。
      }
      finish("cancelled", undefined, abortError(keySignal, work.buildKey, e));
      return;
    }
    finish("failed", undefined, failedError(work.buildKey, e));
  }
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

function createConcurrencyGate(limit: number): { acquire(): Promise<void>; release(): void } {
  let available = limit;
  const waiters: Array<() => void> = [];
  return {
    async acquire() {
      if (available > 0) {
        available -= 1;
        return;
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
    release() {
      const next = waiters.shift();
      if (next) next();
      else available += 1;
    },
  };
}
