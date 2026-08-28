// Experiment Invocation 的轻量 Session 索引。
//
// Session 只回答「哪一批 Run 由同一次 exp 调度、当前是否仍活跃」；完整的
// Attempt / verdict / artifact 继续由 Run 记录保存。所有写入都走逐条目原子
// 文件原语，Session 不参与用例锁或实验级闸的判定。

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { t } from "../i18n/index.ts";
import { Cause, Deferred, Effect, Exit, Fiber, Queue, Scope } from "effect";
import { readAllEntryFilesEffect, writeEntryFileEffect } from "../shared/entry-file-store.ts";
import type {
  CompletionStatus,
  AttemptQueueReason,
  AttemptRef,
  InvocationCompletion,
  InvocationReceipt,
  RunFeedbackEvent,
  RunFeedbackState,
} from "./types.ts";
import type { AgentRun } from "./types.ts";

export const SESSION_HEARTBEAT_INTERVAL_MS = 10_000;
export const SESSION_EXPIRY_MS = 30_000;

export type SessionExperimentState = "setup" | "running" | "waiting" | "teardown";
export type SessionStatus = "active" | "completed" | "incomplete" | "interrupted";

export interface SessionExperimentRecord {
  experimentId: string;
  runId: string;
  /** The Record v1 receipt confirmed that this draft reached a complete marker. */
  published?: boolean;
  state?: SessionExperimentState;
  running?: number;
  queued?: number;
  elsewhere?: number;
  /** Only currently queued Attempts with an actionable, stable reason are expanded. */
  attempts?: SessionQueuedAttemptRecord[];
}

export interface SessionQueuedAttemptRecord {
  evalId: string;
  attempt: number;
  state: "queued";
  reason: AttemptQueueReason;
}

export interface SessionRecord {
  sessionId: string;
  pid: number;
  startedAt: string;
  status: SessionStatus;
  experiments: SessionExperimentRecord[];
  heartbeatAt?: string;
  completedAt?: string;
  completion?: InvocationCompletion;
}

export interface ExpiredSessionRecord {
  sessionId: string;
  pid: number;
  startedAt: string;
  heartbeatAt?: string;
}

export interface SessionListDocument {
  format: "niceeval.sessions";
  sessions: SessionRecord[];
  expired: ExpiredSessionRecord[];
}

export interface SessionShowDocument {
  format: "niceeval.session";
  session: SessionRecord | ExpiredSessionRecord;
  expired?: boolean;
}

export interface SessionStartInput {
  runIds: ReadonlyMap<string, string>;
  agentRuns: readonly AgentRun[];
  /** 已规划、可携入的 attempt 数；用于创建记录时准确初始化 queued。 */
  carriedAttemptsByKey?: ReadonlyMap<string, ReadonlySet<number>>;
  startedAt?: string;
  pid?: number;
}

export interface SessionCloseInput {
  status?: CompletionStatus | SessionStatus;
  completion?: InvocationCompletion;
  /** Only IDs in this receipt are safe targets for `niceeval view --run`. */
  receipt?: InvocationReceipt;
  completedAt?: string;
}

/**
 * Narrow transient event bridge owned by the Experiment Host.  Session data is
 * an invocation-local index, so this intentionally excludes Record facts and
 * every feedback event that cannot change its small progress projection.
 */
export type SessionInvocationEvent =
  | {
      readonly type: "attempt:queued";
      readonly identity?: AttemptRef;
      readonly reason: AttemptQueueReason;
    }
  | {
      readonly type: "attempt:start" | "attempt:complete" | "attempt:early-exit";
      readonly identity?: AttemptRef;
    }
  | {
      readonly type: "lock-wait";
      readonly experimentId: string;
      readonly status: "started" | "resolved";
      readonly attempts?: number;
      readonly carried?: number;
      readonly dispatched?: number;
    }
  | {
      readonly type: "experiment-hook";
      readonly experimentId: string;
      readonly hook: "setup" | "teardown";
      readonly status: "started" | "done" | "failed";
    };

function sessionsDirOf(niceevalRoot: string): string {
  return join(niceevalRoot, "sessions");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeExperiment(value: unknown): SessionExperimentRecord | undefined {
  const raw = asRecord(value);
  if (raw === undefined || typeof raw.experimentId !== "string" || typeof raw.runId !== "string") return undefined;
  if (raw.published !== undefined && typeof raw.published !== "boolean") return undefined;
  const state = raw.state;
  if (state !== undefined && state !== "setup" && state !== "running" && state !== "waiting" && state !== "teardown") {
    return undefined;
  }
  for (const key of ["running", "queued", "elsewhere"] as const) {
    if (raw[key] !== undefined && !isNonNegativeInteger(raw[key])) return undefined;
  }
  const running = raw.running;
  const queued = raw.queued;
  const elsewhere = raw.elsewhere;
  const attempts = raw.attempts === undefined
    ? undefined
    : Array.isArray(raw.attempts)
      ? raw.attempts.map((value): SessionQueuedAttemptRecord | undefined => {
        const attempt = asRecord(value);
        if (
          attempt === undefined ||
          typeof attempt.evalId !== "string" ||
          !isNonNegativeInteger(attempt.attempt) ||
          attempt.state !== "queued" ||
          attempt.reason !== "provider-capacity"
        ) return undefined;
        return {
          evalId: attempt.evalId,
          attempt: attempt.attempt,
          state: "queued",
          reason: attempt.reason,
        };
      })
      : undefined;
  if (raw.attempts !== undefined && (attempts === undefined || attempts.some((item) => item === undefined))) {
    return undefined;
  }
  return {
    experimentId: raw.experimentId,
    runId: raw.runId,
    ...(raw.published === true ? { published: true } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(running !== undefined ? { running: running as number } : {}),
    ...(queued !== undefined ? { queued: queued as number } : {}),
    ...(elsewhere !== undefined ? { elsewhere: elsewhere as number } : {}),
    ...(attempts === undefined ? {} : { attempts: attempts as SessionQueuedAttemptRecord[] }),
  };
}

/** 完整读取边界：损坏/未知格式条目从查询中跳过，不拖垮整个目录。 */
export function decodeSession(value: unknown): SessionRecord | undefined {
  const raw = asRecord(value);
  if (
    raw === undefined ||
    typeof raw.sessionId !== "string" ||
    !isPositiveInteger(raw.pid) ||
    !isTimestamp(raw.startedAt) ||
    (raw.status !== "active" && raw.status !== "completed" && raw.status !== "incomplete" && raw.status !== "interrupted") ||
    !Array.isArray(raw.experiments)
  ) return undefined;
  if (raw.heartbeatAt !== undefined && !isTimestamp(raw.heartbeatAt)) return undefined;
  if (raw.completedAt !== undefined && !isTimestamp(raw.completedAt)) return undefined;
  const experiments = raw.experiments.map(decodeExperiment);
  if (experiments.some((item) => item === undefined)) return undefined;
  return {
    sessionId: raw.sessionId,
    pid: raw.pid,
    startedAt: raw.startedAt,
    status: raw.status,
    experiments: experiments as SessionExperimentRecord[],
    ...(raw.heartbeatAt !== undefined ? { heartbeatAt: raw.heartbeatAt } : {}),
    ...(raw.completedAt !== undefined ? { completedAt: raw.completedAt } : {}),
    ...(raw.completion !== undefined && asRecord(raw.completion) !== undefined
      ? { completion: raw.completion as InvocationCompletion }
      : {}),
  };
}

function keyOf(experimentId: string, evalId: string): string {
  // 与 runner/sandbox-selection.ts 的 runPairKey 保持同形，但避免运行时依赖造成循环导入。
  return experimentId.includes("|") || evalId.includes("|")
    ? JSON.stringify([experimentId, evalId])
    : `${experimentId}|${evalId}`;
}

function sessionStatusOf(status: CompletionStatus | SessionStatus | undefined): SessionStatus {
  if (status === "complete" || status === "completed" || status === undefined) return "completed";
  if (status === "interrupted") return "interrupted";
  return "incomplete";
}

function cloneRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    experiments: record.experiments.map((experiment) => ({
      ...experiment,
      ...(experiment.attempts === undefined
        ? {}
        : { attempts: experiment.attempts.map((attempt) => ({ ...attempt })) }),
    })),
    ...(record.completion ? { completion: { ...record.completion, reporterErrors: [...record.completion.reporterErrors] } } : {}),
  };
}

type SessionPersistenceRequest =
  | {
    readonly _tag: "write";
    readonly snapshot: SessionRecord;
    /** 缺席时是反馈索引的尽力写；失败不影响 attempt 判定。 */
    readonly completion?: Deferred.Deferred<void, unknown>;
  }
  | {
    readonly _tag: "barrier";
    readonly completion: Deferred.Deferred<void, unknown>;
  };

/**
 * Session 的 Effect 资源组刻意不绑定 `start()` 调用点的 Scope：`runEvals()` 自己会
 * 在 dispatch 完成时关闭内部 Scope，但 CLI 仍要在随后拿到 receipt 后再写最终 completed
 * Session。调用方的 `close()`（CLI 已有的 finalizer）才是这一组 worker/timer 的唯一
 * 释放边界。
 */
interface SessionPersistence {
  readonly scope: Scope.Closeable;
  readonly requests: Queue.Queue<SessionPersistenceRequest>;
  readonly worker: Fiber.Fiber<void, never>;
  heartbeat?: Fiber.Fiber<never, never>;
  accepting: boolean;
  stopped: boolean;
}

/**
 * 在 Effect 中等一段不会让 Node 进程仅因 Session 心跳而存活的时间。中断会清掉当前 timer；
 * 这保留旧 `setInterval(...).unref()` 的进程退出语义，同时不会把定时器生命周期漏到 Effect
 * 之外。
 */
function unrefDelayEffect(milliseconds: number): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    const timer = setTimeout(() => resume(Effect.void), milliseconds);
    timer.unref?.();
    return Effect.sync(() => clearTimeout(timer));
  });
}

/** 可持久化的 Session 生命周期；所有磁盘 I/O 由一个 Effect worker 按入队顺序串行化。 */
export class SessionTracker {
  readonly niceevalRoot: string;
  readonly sessionId: string;
  private record: SessionRecord | undefined;
  private persistence: SessionPersistence | undefined;
  private started = false;
  private closed = false;

  constructor(niceevalRoot: string, sessionId = `s_${randomUUID()}`) {
    this.niceevalRoot = niceevalRoot;
    this.sessionId = sessionId;
  }

  get current(): SessionRecord | undefined {
    return this.record === undefined ? undefined : cloneRecord(this.record);
  }

  /**
   * Effect 主入口：先完成第一份 durable snapshot，再开始心跳。持久化 Scope 跨过
   * `runEvals()` 的内部 Scope，由 closeEffect 关闭，因而最终 receipt 不会被抢先截断。
   */
  start(input: SessionStartInput): Effect.Effect<SessionRecord, unknown> {
    let persistence: SessionPersistence | undefined;
    return Effect.gen({ self: this }, function* () {
      if (this.started) return yield* Effect.fail(new Error("SessionTracker.start() called more than once."));
      const scope = yield* Scope.make();
      const requests = yield* Queue.unbounded<SessionPersistenceRequest>();
      const worker = yield* Effect.forkIn(this.persistenceWorkerEffect(requests), scope);
      persistence = { scope, requests, worker, accepting: true, stopped: false };
      this.persistence = persistence;
      this.started = true;

      const startedAt = input.startedAt ?? new Date().toISOString();
      const carried = input.carriedAttemptsByKey;
      const experiments: SessionExperimentRecord[] = [];
      for (const run of input.agentRuns) {
        if (run.experimentId === undefined) continue;
        const runId = input.runIds.get(run.experimentId);
        if (runId === undefined) continue;
        const planned = run.selectedEvalIds.length * run.attempts;
        const carriedCount = run.selectedEvalIds.reduce(
          (count, evalId) => count + (carried?.get(keyOf(run.experimentId!, evalId))?.size ?? 0),
          0,
        );
        const queued = Math.max(0, planned - carriedCount);
        experiments.push({
          experimentId: run.experimentId,
          runId,
          state: run.setup && queued > 0 ? "setup" : "running",
          running: 0,
          queued,
          elsewhere: 0,
        });
      }
      const now = new Date().toISOString();
      this.record = {
        sessionId: this.sessionId,
        pid: input.pid ?? process.pid,
        startedAt,
        status: "active",
        heartbeatAt: now,
        experiments,
      };
      // Unlike feedback snapshots, the initial entry is a durable boundary:
      // dispatch must not start until it has either reached disk or failed.
      yield* this.flush();
      persistence.heartbeat = yield* Effect.forkIn(this.heartbeatLoopEffect(), scope);
      return this.current!;
    }).pipe(
      // A failed first write must not leave the manually held Scope (or its
      // queue worker) alive. Preserve the original failure after cleanup.
      Effect.onError((cause) => persistence === undefined
        ? Effect.void
        : this.stopPersistenceEffect(persistence, Exit.failCause(cause)).pipe(Effect.ignore)),
    );
  }

  /** coordinator 的同步事件回调；只更新最小索引并把 snapshot 交给 Effect-owned serial worker。 */
  onFeedback(event: RunFeedbackEvent, _state?: RunFeedbackState): void {
    if (
      event.type === "attempt:start" ||
      event.type === "attempt:queued" ||
      event.type === "attempt:complete" ||
      event.type === "attempt:early-exit" ||
      event.type === "lock-wait" ||
      event.type === "experiment-hook"
    ) {
      this.onInvocationEvent(event);
    }
  }

  /** Host-side observer bridge; no runtime is started from a synchronous callback. */
  onInvocationEvent(event: SessionInvocationEvent): void {
    if (!this.started || this.closed || this.record === undefined || this.record.status !== "active") return;
    const identity = "identity" in event && event.identity !== undefined ? event.identity : undefined;
    const experimentId = identity
      ? identity.experimentId
      : "experimentId" in event
        ? event.experimentId
        : undefined;
    const experiment = experimentId === undefined
      ? undefined
      : this.record.experiments.find((item) => item.experimentId === experimentId);
    let changed = false;
    const removeQueuedAttempt = (): boolean => {
      if (experiment === undefined || identity?.evalId === undefined || identity.attempt === undefined) return false;
      const attempts = experiment.attempts ?? [];
      const index = attempts.findIndex((attempt) =>
        attempt.evalId === identity.evalId && attempt.attempt === identity.attempt
      );
      if (index < 0) return false;
      attempts.splice(index, 1);
      if (attempts.length === 0) delete experiment.attempts;
      else experiment.attempts = attempts;
      return true;
    };
    if (event.type === "attempt:queued" && experiment && identity) {
      removeQueuedAttempt();
      experiment.attempts = [
        ...(experiment.attempts ?? []),
        { evalId: identity.evalId, attempt: identity.attempt, state: "queued", reason: event.reason },
      ];
      this.refreshState(experiment);
      changed = true;
    } else if (event.type === "attempt:start" && experiment) {
      removeQueuedAttempt();
      experiment.queued = Math.max(0, (experiment.queued ?? 0) - 1);
      experiment.running = (experiment.running ?? 0) + 1;
      experiment.state = "running";
      changed = true;
    } else if (event.type === "attempt:complete" && experiment) {
      const completedWhileQueued = removeQueuedAttempt();
      if (completedWhileQueued) experiment.queued = Math.max(0, (experiment.queued ?? 0) - 1);
      else experiment.running = Math.max(0, (experiment.running ?? 0) - 1);
      this.refreshState(experiment);
      changed = true;
    } else if (event.type === "attempt:early-exit" && experiment) {
      removeQueuedAttempt();
      experiment.queued = Math.max(0, (experiment.queued ?? 0) - 1);
      this.refreshState(experiment);
      changed = true;
    } else if (event.type === "lock-wait" && experiment) {
      if (event.status === "started") {
        const attempts = event.attempts ?? 1;
        experiment.queued = Math.max(0, (experiment.queued ?? 0) - attempts);
        experiment.elsewhere = (experiment.elsewhere ?? 0) + attempts;
        experiment.state = "waiting";
        changed = true;
      } else {
        const moved = (event.carried ?? 0) + (event.dispatched ?? 0);
        experiment.elsewhere = Math.max(0, (experiment.elsewhere ?? 0) - moved);
        experiment.queued = (experiment.queued ?? 0) + (event.dispatched ?? 0);
        this.refreshState(experiment);
        changed = true;
      }
    } else if (event.type === "experiment-hook" && experiment) {
      if (event.status === "started") experiment.state = event.hook === "setup" ? "setup" : "teardown";
      else this.refreshState(experiment);
      changed = true;
    }
    if (changed) this.enqueuePersist();
  }

  private refreshState(experiment: SessionExperimentRecord): void {
    if ((experiment.elsewhere ?? 0) > 0 && (experiment.running ?? 0) === 0) {
      experiment.state = "waiting";
    } else if ((experiment.running ?? 0) > 0 || (experiment.queued ?? 0) > 0) {
      experiment.state = "running";
    } else {
      experiment.state = "teardown";
    }
  }

  /** 一次可观察的 heartbeat；显式调用者会收到本次 flush 的真实 I/O failure。 */
  heartbeat(): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (!this.started || this.closed || this.record === undefined || this.record.status !== "active") return Effect.void;
      this.record.heartbeatAt = new Date().toISOString();
      return this.flush();
    });
  }

  /**
   * 完成最终 Session：先停止 heartbeat，再把完成 snapshot 排在所有既有反馈写之后。该收尾
   * 区域不可中断，避免 interruption 留下 active 条目或后台 Fiber。
   */
  close(input: SessionCloseInput = {}): Effect.Effect<SessionRecord | undefined, unknown> {
    return Effect.uninterruptible(Effect.suspend(() => {
      if (!this.started || this.record === undefined || this.closed) return Effect.succeed(this.current);
      this.closed = true;
      const now = new Date().toISOString();
      this.record.status = sessionStatusOf(input.status);
      this.record.completedAt = input.completedAt ?? now;
      delete this.record.heartbeatAt;
      if (input.completion !== undefined) this.record.completion = input.completion;
      const publishedRunIds = new Set(input.receipt?.createdRunIds ?? []);
      for (const experiment of this.record.experiments) {
        if (publishedRunIds.has(experiment.runId)) experiment.published = true;
        else delete experiment.published;
        delete experiment.state;
        delete experiment.running;
        delete experiment.queued;
        delete experiment.elsewhere;
        delete experiment.attempts;
      }
      const snapshot = cloneRecord(this.record);
      const persistence = this.persistence;
      const persist = persistence === undefined
        ? writeEntryFileEffect(sessionsDirOf(this.niceevalRoot), this.sessionId, snapshot)
        : this.stopPersistenceEffect(persistence, Exit.void, snapshot);
      return persist.pipe(Effect.as(this.current));
    }));
  }

  /** 按入队顺序强制写出当前 snapshot；worker 已关闭后退化为同一条 *Effect 原语的直接写。 */
  private flush(): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (this.record === undefined) return Effect.void;
      const snapshot = cloneRecord(this.record);
      const persistence = this.persistence;
      return persistence !== undefined && persistence.accepting && !persistence.stopped
        ? this.offerWriteEffect(persistence, snapshot)
        : writeEntryFileEffect(sessionsDirOf(this.niceevalRoot), this.sessionId, snapshot);
    });
  }

  private enqueuePersist(): void {
    const persistence = this.persistence;
    if (
      this.record === undefined ||
      persistence === undefined ||
      !persistence.accepting ||
      persistence.stopped
    ) return;
    const snapshot = cloneRecord(this.record);
    // 反馈 API 受 coordinator 的同步 callback 契约限制，不能在这里启动 runtime。Queue 是
    // Effect worker 的同步入口；false 只会发生在 close 已关闭队列的竞态，此时最终 flush
    // 已覆盖当前 record。
    Queue.offerUnsafe(persistence.requests, { _tag: "write", snapshot });
  }

  private persistenceWorkerEffect(
    requests: Queue.Queue<SessionPersistenceRequest>,
  ): Effect.Effect<void> {
    const handle = (request: SessionPersistenceRequest): Effect.Effect<void> => {
      if (request._tag === "barrier") {
        return Deferred.succeed(request.completion, undefined).pipe(Effect.asVoid);
      }
      // Each request owns a frozen snapshot. Capture the full Exit before
      // settling its waiter so a failed heartbeat cannot kill the serial
      // worker; a later state change is still allowed to retry the index write.
      return writeEntryFileEffect(sessionsDirOf(this.niceevalRoot), this.sessionId, request.snapshot).pipe(
        Effect.exit,
        Effect.flatMap((exit) => request.completion === undefined
          ? Effect.void
          : Deferred.done(request.completion, exit).pipe(Effect.asVoid)),
      );
    };
    return Effect.forever(Queue.take(requests).pipe(Effect.flatMap(handle))).pipe(
      // Queue shutdown interrupts its pending take. A different cause is a
      // broken worker invariant and stays a defect instead of being erased.
      Effect.catchCause((cause) => Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.die(cause)),
    );
  }

  private heartbeatLoopEffect(): Effect.Effect<never> {
    return Effect.forever(
      unrefDelayEffect(SESSION_HEARTBEAT_INTERVAL_MS).pipe(
        // Heartbeats are observability only. Explicit heartbeat callers
        // receive failures; the background loop deliberately retries later.
        Effect.andThen(this.heartbeat().pipe(Effect.ignore)),
      ),
    );
  }

  private offerWriteEffect(
    persistence: SessionPersistence,
    snapshot: SessionRecord,
  ): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
      const completion = yield* Deferred.make<void, unknown>();
      const accepted = yield* Effect.sync(() => Queue.offerUnsafe(
        persistence.requests,
        { _tag: "write", snapshot, completion },
      ));
      if (!accepted) return yield* Effect.fail(new Error("Session persistence queue closed before flush."));
      yield* Deferred.await(completion);
    });
  }

  private barrierEffect(persistence: SessionPersistence): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
      const completion = yield* Deferred.make<void, unknown>();
      const accepted = yield* Effect.sync(() => Queue.offerUnsafe(
        persistence.requests,
        { _tag: "barrier", completion },
      ));
      if (!accepted) return yield* Effect.fail(new Error("Session persistence queue closed before drain."));
      yield* Deferred.await(completion);
    });
  }

  /**
   * 停止顺序固定为：拒绝新反馈 → 等 heartbeat 停稳 → FIFO flush/barrier → shutdown queue →
   * close Scope。因而 final snapshot 不会被较早的后台写覆盖，且任一路径都会终结两条 Fiber。
   */
  private stopPersistenceEffect(
    persistence: SessionPersistence,
    exit: Exit.Exit<unknown, unknown>,
    finalSnapshot?: SessionRecord,
  ): Effect.Effect<void, unknown> {
    return Effect.uninterruptible(Effect.suspend(() => {
      if (persistence.stopped) return Effect.void;
      persistence.accepting = false;
      const stopHeartbeat = persistence.heartbeat === undefined
        ? Effect.void
        : Fiber.interrupt(persistence.heartbeat).pipe(Effect.asVoid);
      const drain = finalSnapshot === undefined
        ? this.barrierEffect(persistence)
        : this.offerWriteEffect(persistence, finalSnapshot);
      return stopHeartbeat.pipe(
        Effect.andThen(drain),
        Effect.ensuring(this.releasePersistenceEffect(persistence, exit)),
      );
    }));
  }

  private releasePersistenceEffect(
    persistence: SessionPersistence,
    exit: Exit.Exit<unknown, unknown>,
  ): Effect.Effect<void> {
    return Effect.uninterruptible(Effect.suspend(() => {
      if (persistence.stopped) return Effect.void;
      persistence.stopped = true;
      if (this.persistence === persistence) this.persistence = undefined;
      return Queue.shutdown(persistence.requests).pipe(
        Effect.andThen(Scope.close(persistence.scope, exit)),
      );
    }));
  }

}

export function isSessionExpired(record: SessionRecord, nowMs = Date.now()): boolean {
  if (record.status !== "active") return false;
  const heartbeatMs = Date.parse(record.heartbeatAt ?? "");
  return !Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > SESSION_EXPIRY_MS;
}

function expiredProjection(record: SessionRecord): ExpiredSessionRecord {
  return {
    sessionId: record.sessionId,
    pid: record.pid,
    startedAt: record.startedAt,
    ...(record.heartbeatAt !== undefined ? { heartbeatAt: record.heartbeatAt } : {}),
  };
}

/** 完整读取边界仍由 entry-file-store 的 decoder 容错纪律拥有。 */
export function readSessions(niceevalRoot: string): Effect.Effect<SessionRecord[], unknown> {
  return readAllEntryFilesEffect(sessionsDirOf(niceevalRoot), decodeSession).pipe(
    Effect.map((entries) => entries.map(({ entry }) => entry).sort((a, b) => a.startedAt.localeCompare(b.startedAt))),
  );
}

export function sessionListDocument(
  records: readonly SessionRecord[],
  options: { all?: boolean; selector?: string; nowMs?: number } = {},
): SessionListDocument {
  const selector = options.selector;
  const matches = (record: SessionRecord): boolean => selector === undefined || record.experiments.some(
    (experiment) => experiment.experimentId.startsWith(selector),
  );
  const sessions: SessionRecord[] = [];
  const expired: ExpiredSessionRecord[] = [];
  for (const record of records) {
    if (!matches(record)) continue;
    if (isSessionExpired(record, options.nowMs)) {
      expired.push(expiredProjection(record));
    } else if (record.status === "active" || options.all === true) {
      sessions.push(cloneRecord(record));
    }
  }
  return { format: "niceeval.sessions", sessions, expired };
}

export function listSessions(
  niceevalRoot: string,
  options: { all?: boolean; selector?: string; nowMs?: number } = {},
): Effect.Effect<SessionListDocument, unknown> {
  return readSessions(niceevalRoot).pipe(Effect.map((records) => sessionListDocument(records, options)));
}

export function resolveSessionPrefix(records: readonly SessionRecord[], prefix: string): SessionRecord {
  const matches = records.filter((record) => record.sessionId === prefix || record.sessionId.startsWith(prefix));
  if (matches.length === 0) throw new Error(`No session matched: ${prefix}`);
  if (matches.length > 1) {
    throw new Error(`Ambiguous session prefix ${prefix}. Candidates: ${matches.map((record) => record.sessionId).join(", ")}`);
  }
  return cloneRecord(matches[0]!);
}

export function showSession(
  niceevalRoot: string,
  prefix: string,
  nowMs = Date.now(),
): Effect.Effect<SessionShowDocument, unknown> {
  return readSessions(niceevalRoot).pipe(
    Effect.map((records) => {
      const record = resolveSessionPrefix(records, prefix);
      const expired = isSessionExpired(record, nowMs);
      return {
        format: "niceeval.session",
        session: expired ? expiredProjection(record) : record,
        ...(expired ? { expired: true } : {}),
      };
    }),
  );
}

function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

function ageLabel(iso: string, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - Date.parse(iso));
  if (elapsed < 1_000) return "now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  return `${Math.floor(elapsed / 3_600_000)}h ago`;
}

function renderExperimentLine(experiment: SessionExperimentRecord, published: boolean): string {
  if (published) {
    return `  ${experiment.experimentId}  niceeval view --run ${experiment.runId}`;
  }
  const counters = [
    experiment.running ? `${experiment.running} running` : "",
    experiment.queued ? `${experiment.queued} queued` : "",
    experiment.elsewhere ? `${experiment.elsewhere} elsewhere` : "",
  ].filter(Boolean);
  return `  ${experiment.experimentId}  @run:${shortRunId(experiment.runId)}  ${experiment.state ?? "running"}${counters.length ? ` · ${counters.join(" · ")}` : ""}`;
}

function publishedForSession(experiment: SessionExperimentRecord, status: SessionStatus): boolean {
  // Older session entries have no receipt marker. Preserve their established
  // completed/interrupted behavior while new entries rely on the exact receipt.
  return experiment.published ?? (status === "completed" || status === "interrupted");
}

export function renderSessionListText(document: SessionListDocument, nowMs = Date.now(), all = false): string {
  const lines: string[] = [`ACTIVE SESSIONS (${document.sessions.filter((session) => session.status === "active").length})`];
  const active = document.sessions.filter((session) => session.status === "active");
  if (active.length === 0) lines.push("(none)");
  for (const session of active) {
    lines.push(`${session.sessionId} · pid ${session.pid} · ${ageLabel(session.startedAt, nowMs)} · heartbeat ${ageLabel(session.heartbeatAt ?? session.startedAt, nowMs)}`);
    lines.push(...session.experiments.map((experiment) => renderExperimentLine(experiment, false)));
  }
  if (all) {
    const completed = document.sessions.filter((session) => session.status !== "active");
    lines.push(`COMPLETED SESSIONS (${completed.length})`);
    if (completed.length === 0) lines.push("(none)");
    for (const session of completed) {
      lines.push(`${session.sessionId} · pid ${session.pid} · ${session.status} · completed ${session.completedAt ?? "—"}`);
      lines.push(...session.experiments.map((experiment) =>
        renderExperimentLine(experiment, publishedForSession(experiment, session.status))
      ));
    }
    if (document.expired.length > 0) {
      lines.push(`EXPIRED SESSIONS (${document.expired.length})`);
      for (const expired of document.expired) {
        lines.push(`${expired.sessionId} · pid ${expired.pid} · heartbeat ${expired.heartbeatAt ?? "unknown"} · ${t("session.rerunOriginal")}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderSessionShowText(document: SessionShowDocument): string {
  const session = document.session;
  const lines = [`SESSION ${session.sessionId}${document.expired ? " · EXPIRED" : ""}`, `pid ${session.pid} · started ${session.startedAt}`];
  if ("status" in session) lines.push(`status ${session.status}${session.completedAt ? ` · completed ${session.completedAt}` : ""}`);
  if ("experiments" in session) {
    lines.push(...session.experiments.map((experiment) =>
      renderExperimentLine(experiment, publishedForSession(experiment, session.status))
    ));
  }
  if (document.expired) lines.push(t("session.nextRerunOriginal"));
  return `${lines.join("\n")}\n`;
}
