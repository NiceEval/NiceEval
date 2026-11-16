// Experiment Invocation 的轻量 Session 索引。
//
// Session 只回答「哪一批 Run 由同一次 exp 调度、当前是否仍活跃」；完整的
// Attempt / verdict / artifact 继续由 Run 记录保存。所有写入都走逐条目原子
// 文件原语，Session 不参与用例锁或实验级闸的判定。

import { Schema, SchemaGetter } from "effect";
import { omitUndefined } from "../shared/omit-undefined.ts";
import type { LifecyclePhase } from "./types.ts";
import { projectLifecyclePhase } from "../inspection/lifecycle.ts";
import { randomUUID } from "node:crypto";
import { Cause, Deferred, Effect, Exit, Fiber, Queue, Scope } from "effect";
import {
  type FencedOwner,
  type InvocationRunInput,
  type InvocationSessionRecord,
} from "../coordination/platform/sqlite-coordination.ts";
import { ProjectStateDatabase, type ProjectStateDatabaseService } from "../record/sqlite/project-state-database.ts";
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
import { currentProcessOwnerIdentity } from "./node-process-identity.ts";
import { SqliteRecordError } from "../record/sqlite/errors.ts";
import { RunStorageError } from "../run/storage/errors.ts";
import type { RunStorageCommandError } from "../run/storage/index.ts";
import { isExternalCause, normalizeExternalCause } from "../shared/external-cause.ts";

function sessionFailure(cause: unknown): RunStorageCommandError {
  if (cause instanceof SqliteRecordError || cause instanceof RunStorageError || isExternalCause(cause)) return cause;
  return normalizeExternalCause(cause);
}

export const SESSION_HEARTBEAT_INTERVAL_MS = 10_000;
export const SESSION_EXPIRY_MS = 30_000;

export type SessionExperimentState = "setup" | "running" | "waiting" | "teardown";
export type SessionStatus = "active" | "completed" | "incomplete" | "interrupted";

interface SessionExperimentBase {
  experimentId: string;
  runId: string;
  /** The publication receipt confirmed that this draft reached a complete marker. */
  published: boolean;
}

export interface ActiveSessionExperimentRecord extends SessionExperimentBase {
  lifecycle: "active";
  state: SessionExperimentState;
  running: number;
  queued: number;
  elsewhere: number;
  /** Only currently queued Attempts with an actionable, stable reason are expanded. */
  attempts: SessionQueuedAttemptRecord[];
  activeAttempts: SessionActiveAttemptRecord[];
}

export interface TerminalSessionExperimentRecord extends SessionExperimentBase {
  lifecycle: "terminal";
}

export type SessionExperimentRecord = ActiveSessionExperimentRecord | TerminalSessionExperimentRecord;

const LifecyclePhaseSchema = Schema.Literals([
  "judge.precheck",
  "experiment.before",
  "experiment.after",
  "attempt.before",
  "attempt.after",
  "sandbox.queue",
  "sandbox.create",
  "sandbox.prepare",
  "sandbox.prepare.eval",
  "sandbox.prepare.group",
  "sandbox.prepare.experiment",
  "agent.install",
  "workspace.baseline",
  "agent.before",
  "telemetry.configure",
  "eval.run",
  "agent.run",
  "workspace.diff",
  "assertions.evaluate",
  "telemetry.collect",
  "agent.after",
  "sandbox.cleanup",
  "sandbox.suspend",
  "sandbox.stop",
] satisfies readonly ReturnType<typeof projectLifecyclePhase<LifecyclePhase>>[]);

function sessionOptional<S extends Schema.Constraint>(schema: S) {
  return Schema.NullOr(schema).pipe(
    Schema.decodeTo(Schema.UndefinedOr(Schema.toType(schema)), {
      decode: SchemaGetter.transform((value) => value ?? undefined),
      encode: SchemaGetter.transform((value) => value ?? null),
    }),
  );
}

export const SessionActiveAttemptsSchema = Schema.mutable(
  Schema.Array(
    Schema.Struct({
      evalId: Schema.String,
      attemptOrdinal: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
      phase: LifecyclePhaseSchema,
      phaseEnteredAt: Schema.String,
      sandbox: sessionOptional(
        Schema.Struct({ provider: Schema.String, nativeInstanceId: sessionOptional(Schema.String) }),
      ),
      detail: sessionOptional(Schema.Struct({ text: Schema.String, at: Schema.String })),
    }),
  ),
);

export interface SessionActiveAttemptRecord {
  evalId: string;
  attemptOrdinal: number;
  phase: ReturnType<typeof projectLifecyclePhase<LifecyclePhase>>;
  phaseEnteredAt: string;
  sandbox: { provider: string; nativeInstanceId: string | undefined } | undefined;
  detail: { text: string; at: string } | undefined;
}

export interface SessionQueuedAttemptRecord {
  evalId: string;
  attempt: number;
  state: "queued";
  reason: AttemptQueueReason;
}

interface SessionRecordBase {
  sessionId: string;
  pid: number;
  startedAt: string;
}

export type SessionRecord = SessionRecordBase &
  (
    | { status: "active"; heartbeatAt: string | undefined; experiments: ActiveSessionExperimentRecord[] }
    | {
        status: "completed" | "incomplete" | "interrupted";
        experiments: TerminalSessionExperimentRecord[];
        completedAt: string | undefined;
        completion: InvocationCompletion | undefined;
      }
  );

export interface ExpiredSessionRecord {
  sessionId: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string | undefined;
}

export interface SessionListDocument {
  sessions: SessionRecord[];
  expired: ExpiredSessionRecord[];
}

export interface SessionShowDocument {
  session: SessionRecord | ExpiredSessionRecord;
  expired: boolean | undefined;
}

export interface SessionStartInput {
  runIds: ReadonlyMap<string, string>;
  agentRuns: readonly AgentRun[];
  /** 已规划、可携入的 attempt 数；用于创建记录时准确初始化 queued。 */
  carriedAttemptsByKey?: ReadonlyMap<string, ReadonlySet<number>> | undefined;
  startedAt?: string | undefined;
  pid?: number | undefined;
  /** Complete canonical Run resources created atomically with this Invocation. */
  invocationRuns: readonly InvocationRunInput[];
}

export interface SessionCloseInput {
  status?: CompletionStatus | SessionStatus | undefined;
  completion?: InvocationCompletion | undefined;
  /** Only IDs in this receipt are safe targets for `niceeval show run:<id>`. */
  receipt?: InvocationReceipt | undefined;
  completedAt?: string | undefined;
}

/**
 * Narrow transient event bridge owned by the Experiment Host.  Session data is
 * an invocation-local index, so this intentionally excludes Record facts and
 * every feedback event that cannot change its small progress projection.
 */
export type SessionInvocationEvent =
  | Extract<RunFeedbackEvent, { type: "attempt:phase" | "attempt:progress" | "attempt:sandbox" }>
  | {
      readonly type: "attempt:queued";
      readonly identity: AttemptRef | undefined;
      readonly reason: AttemptQueueReason;
    }
  | {
      readonly type: "attempt:start";
      readonly identity: AttemptRef | undefined;
      readonly phase: LifecyclePhase | undefined;
      readonly at: number | undefined;
    }
  | {
      readonly type: "attempt:complete" | "attempt:early-exit";
      readonly identity: AttemptRef | undefined;
    }
  | {
      readonly type: "lock-wait";
      readonly experimentId: string;
      readonly status: "started" | "resolved";
      readonly attempts: number | undefined;
      readonly carried: number | undefined;
      readonly dispatched: number | undefined;
    }
  | {
      readonly type: "experiment-hook";
      readonly experimentId: string;
      readonly hook: "setup" | "teardown";
      readonly status: "started" | "done" | "failed";
    };

const NonNegativeIntegerSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const TimestampSchema = Schema.String.check(Schema.makeFilter((value) => Number.isFinite(Date.parse(value))));
const CompletionSchema = Schema.Struct({
  status: Schema.Literals(["complete", "incomplete", "interrupted"]),
  unstarted: NonNegativeIntegerSchema,
  earlyExitUnstarted: NonNegativeIntegerSchema,
  reporterErrors: Schema.Array(
    Schema.Struct({
      reporter: Schema.String,
      required: Schema.Boolean,
      message: Schema.String,
    }),
  ),
});
const ExperimentPayloadFields = {
  experimentId: Schema.String,
  runId: Schema.String,
  published: Schema.optionalKey(Schema.Boolean),
};
const ActiveExperimentPayloadSchema = Schema.Struct({
  ...ExperimentPayloadFields,
  state: Schema.Literals(["setup", "running", "waiting", "teardown"]),
  running: NonNegativeIntegerSchema,
  queued: NonNegativeIntegerSchema,
  elsewhere: NonNegativeIntegerSchema,
  attempts: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        evalId: Schema.String,
        attempt: NonNegativeIntegerSchema,
        state: Schema.Literal("queued"),
        reason: Schema.Literal("provider-capacity"),
      }),
    ),
  ),
  activeAttempts: Schema.toEncoded(SessionActiveAttemptsSchema),
});
const SessionPayloadFields = {
  sessionId: Schema.String,
  pid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  startedAt: TimestampSchema,
};
/** Record JSON and CLI JSON observe omitted keys; these payloads use exact optional keys. */
export const SessionRecordPayloadSchema = Schema.Union([
  Schema.Struct({
    ...SessionPayloadFields,
    status: Schema.Literal("active"),
    experiments: Schema.mutable(Schema.Array(ActiveExperimentPayloadSchema)),
    heartbeatAt: Schema.optionalKey(TimestampSchema),
  }),
  Schema.Struct({
    ...SessionPayloadFields,
    status: Schema.Literals(["completed", "incomplete", "interrupted"]),
    experiments: Schema.mutable(Schema.Array(Schema.Struct(ExperimentPayloadFields))),
    completedAt: Schema.optionalKey(TimestampSchema),
    completion: Schema.optionalKey(CompletionSchema),
  }),
]);
export type SessionRecordPayload = typeof SessionRecordPayloadSchema.Type;

/** Record JSON and CLI JSON observe omission of an unavailable heartbeat. */
export const ExpiredSessionPayloadSchema = Schema.Struct({
  ...SessionPayloadFields,
  heartbeatAt: Schema.optionalKey(TimestampSchema),
});

/** Reject malformed current-format projections; predecessor Records never reach this boundary. */
export function decodeSession(value: unknown): SessionRecord | undefined {
  const decoded = Schema.decodeUnknownResult(SessionRecordPayloadSchema, { onExcessProperty: "error" })(value);
  if (decoded._tag === "Failure") return undefined;
  const payload = decoded.success;
  if (payload.status === "active") {
    return {
      ...payload,
      heartbeatAt: payload.heartbeatAt,
      experiments: payload.experiments.map((experiment) => ({
        ...experiment,
        lifecycle: "active",
        published: experiment.published === true,
        activeAttempts: Schema.decodeUnknownSync(SessionActiveAttemptsSchema)(experiment.activeAttempts),
      })),
    };
  }
  return {
    ...payload,
    completedAt: payload.completedAt,
    completion: payload.completion,
    experiments: payload.experiments.map((experiment) => ({
      experimentId: experiment.experimentId,
      runId: experiment.runId,
      lifecycle: "terminal",
      published: experiment.published === true,
    })),
  };
}

function keyOf(experimentId: string, evalId: string): string {
  // 与 runner/sandbox-selection.ts 的 runPairKey 保持同形，但避免运行时依赖造成循环导入。
  return experimentId.includes("|") || evalId.includes("|")
    ? JSON.stringify([experimentId, evalId])
    : `${experimentId}|${evalId}`;
}

function sessionStatusOf(status: CompletionStatus | SessionStatus | undefined): Exclude<SessionStatus, "active"> {
  if (status === "complete" || status === "completed" || status === undefined) return "completed";
  if (status === "interrupted") return "interrupted";
  return "incomplete";
}

function cloneRecord(record: SessionRecord): SessionRecord {
  if (record.status === "active") {
    return {
      ...record,
      experiments: record.experiments.map((experiment) => ({
        ...experiment,
        activeAttempts: experiment.activeAttempts.map((item) => ({
          ...item,
          sandbox: item.sandbox === undefined ? undefined : { ...item.sandbox },
          detail: item.detail === undefined ? undefined : { ...item.detail },
        })),
        attempts: experiment.attempts.map((attempt) => ({ ...attempt })),
      })),
    };
  }
  return {
    ...record,
    experiments: record.experiments.map((experiment) => ({ ...experiment })),
    completion: record.completion && { ...record.completion, reporterErrors: [...record.completion.reporterErrors] },
  };
}

/** Convert internal lifecycle values to the independently typed Record / CLI JSON payload. */
export function sessionRecordToJson(record: SessionRecord): SessionRecordPayload {
  const base = { sessionId: record.sessionId, pid: record.pid, startedAt: record.startedAt };
  if (record.status === "active") {
    return omitUndefined({
      ...base,
      status: record.status,
      heartbeatAt: record.heartbeatAt,
      experiments: record.experiments.map((experiment) =>
        omitUndefined({
          experimentId: experiment.experimentId,
          runId: experiment.runId,
          published: experiment.published ? true : undefined,
          state: experiment.state,
          running: experiment.running,
          queued: experiment.queued,
          elsewhere: experiment.elsewhere,
          attempts: experiment.attempts,
          activeAttempts: Schema.encodeSync(SessionActiveAttemptsSchema)(experiment.activeAttempts),
        }),
      ),
    });
  }
  return omitUndefined({
    ...base,
    status: record.status,
    completedAt: record.completedAt,
    completion: record.completion,
    experiments: record.experiments.map((experiment) =>
      omitUndefined({
        experimentId: experiment.experimentId,
        runId: experiment.runId,
        published: experiment.published ? true : undefined,
      }),
    ),
  });
}

function encodeSession(record: SessionRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sessionRecordToJson(record)));
}

function decodeSessionBytes(bytes: Uint8Array): SessionRecord | undefined {
  try {
    return decodeSession(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return undefined;
  }
}

type SessionObservationWrite = { readonly _tag: "observe"; snapshot: SessionRecord };

type SessionPersistenceRequest =
  | SessionObservationWrite
  | {
      readonly _tag: "write";
      readonly snapshot: SessionRecord;
      /** 缺席时是反馈索引的尽力写；失败不影响 attempt 判定。 */
      readonly completion: Deferred.Deferred<void, RunStorageCommandError> | undefined;
    }
  | {
      readonly _tag: "barrier";
      readonly completion: Deferred.Deferred<void, RunStorageCommandError>;
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
  heartbeat: Fiber.Fiber<never, never> | undefined;
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
  private pendingObservation: SessionObservationWrite | undefined;
  private started = false;
  private closed = false;
  private owner: FencedOwner | undefined;
  private readonly database: ProjectStateDatabaseService;

  constructor(niceevalRoot: string, database: ProjectStateDatabaseService, sessionId = `s_${randomUUID()}`) {
    this.niceevalRoot = niceevalRoot;
    this.database = database;
    this.sessionId = sessionId;
  }

  private invocationEffect<A extends import("../record/sqlite/worker-protocol.ts").StorageWorkerResult>(
    command: import("../record/sqlite/worker-protocol.ts").InvocationCommand,
  ): Effect.Effect<A, RunStorageCommandError> {
    return Effect.flatMap(this.database.bind(this.niceevalRoot), (facets) =>
      Effect.tryPromise({
        try: () => facets.invocation.execute<A>(command),
        catch: sessionFailure,
      }),
    );
  }

  get current(): SessionRecord | undefined {
    return this.record === undefined ? undefined : cloneRecord(this.record);
  }

  /**
   * Effect 主入口：先完成第一份 durable snapshot，再开始心跳。持久化 Scope 跨过
   * `runEvals()` 的内部 Scope，由 closeEffect 关闭，因而最终 receipt 不会被抢先截断。
   */
  start(input: SessionStartInput): Effect.Effect<SessionRecord, RunStorageCommandError> {
    let persistence: SessionPersistence | undefined;
    return Effect.gen({ self: this }, function* () {
      if (this.started)
        return yield* Effect.fail(normalizeExternalCause(new Error("SessionTracker.start() called more than once.")));
      const scope = yield* Scope.make();
      const requests = yield* Queue.unbounded<SessionPersistenceRequest>();
      const worker = yield* Effect.forkIn(this.persistenceWorkerEffect(requests), scope);
      const currentPersistence: SessionPersistence = {
        scope,
        requests,
        worker,
        heartbeat: undefined,
        accepting: true,
        stopped: false,
      };
      persistence = currentPersistence;
      this.persistence = currentPersistence;
      this.started = true;

      const startedAt = input.startedAt ?? new Date().toISOString();
      const carried = input.carriedAttemptsByKey;
      const experiments: ActiveSessionExperimentRecord[] = [];
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

          lifecycle: "active",
          published: false,
          attempts: [],
          activeAttempts: [],
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
      const owner = currentProcessOwnerIdentity(this.sessionId);
      this.owner = (yield* this.invocationEffect<InvocationSessionRecord>({
        _tag: "invocation-create",
        input: {
          invocationId: this.sessionId,
          owner,
          startedAt,
          runs: input.invocationRuns,
          deadlineEpochMs: Date.now() + 30_000,
          queuedAttempts: undefined,
        },
      })).owner;
      // Unlike feedback snapshots, the initial entry is a durable boundary:
      // dispatch must not start until it has either reached disk or failed.
      yield* this.flush();
      currentPersistence.heartbeat = yield* Effect.forkIn(this.heartbeatLoopEffect(), scope);
      return this.current!;
    }).pipe(
      // A failed first write must not leave the manually held Scope (or its
      // queue worker) alive. Preserve the original failure after cleanup.
      Effect.onError((cause) =>
        persistence === undefined
          ? Effect.void
          : this.stopPersistenceEffect(persistence, Exit.failCause(cause)).pipe(Effect.ignore),
      ),
    );
  }

  /** coordinator 的同步事件回调；只更新最小索引并把 snapshot 交给 Effect-owned serial worker。 */
  onFeedback(event: RunFeedbackEvent, _state?: RunFeedbackState): void {
    if (
      event.type === "attempt:start" ||
      event.type === "attempt:phase" ||
      event.type === "attempt:progress" ||
      event.type === "attempt:sandbox" ||
      event.type === "attempt:queued" ||
      event.type === "attempt:complete" ||
      event.type === "attempt:early-exit" ||
      event.type === "lock-wait" ||
      event.type === "experiment-hook"
    ) {
      this.onInvocationEvent(event);
    }
  }

  /** Applies the frozen carry decision before dispatch without inventing lifecycle events. */
  applyCarriedAttempts(
    agentRuns: readonly AgentRun[],
    carried: ReadonlyMap<string, ReadonlySet<number>>,
  ): Effect.Effect<void, RunStorageCommandError> {
    if (this.record === undefined || this.record.status !== "active") return Effect.void;
    for (const experiment of this.record.experiments) {
      const run = agentRuns.find((candidate) => candidate.experimentId === experiment.experimentId);
      const count =
        run?.selectedEvalIds.reduce(
          (total, evalId) => total + (carried.get(keyOf(experiment.experimentId, evalId))?.size ?? 0),
          0,
        ) ?? 0;
      experiment.queued = Math.max(0, experiment.queued - count);
      this.refreshState(experiment);
    }
    return this.flush();
  }

  /** Host-side observer bridge; no runtime is started from a synchronous callback. */
  onInvocationEvent(event: SessionInvocationEvent): void {
    if (!this.started || this.closed || this.record === undefined || this.record.status !== "active") return;
    const identity = "identity" in event && event.identity !== undefined ? event.identity : undefined;
    function eventExperimentId(): string | undefined {
      if (identity) return identity.experimentId;
      if ("experimentId" in event) return event.experimentId;
      return undefined;
    }
    const experimentId = eventExperimentId();
    const experiment =
      experimentId === undefined
        ? undefined
        : this.record.experiments.find((item) => item.experimentId === experimentId);
    let changed = false;
    const removeQueuedAttempt = (): boolean => {
      if (experiment === undefined || identity?.evalId === undefined || identity.attempt === undefined) return false;
      const attempts = experiment.attempts;
      const index = attempts.findIndex(
        (attempt) => attempt.evalId === identity.evalId && attempt.attempt === identity.attempt,
      );
      if (index < 0) return false;
      attempts.splice(index, 1);
      return true;
    };
    const active = experiment?.activeAttempts.find(
      (item) => item.evalId === identity?.evalId && item.attemptOrdinal === (identity?.attempt ?? -2) + 1,
    );
    if (event.type === "attempt:phase" && active) {
      active.phase = projectLifecyclePhase(event.phase);
      active.phaseEnteredAt = new Date(event.at).toISOString();
      changed = true;
    } else if (event.type === "attempt:progress" && active) {
      active.detail = { text: event.detail, at: new Date(event.at).toISOString() };
      changed = true;
    } else if (event.type === "attempt:sandbox" && active) {
      active.sandbox = { provider: event.provider, nativeInstanceId: event.nativeInstanceId };
      changed = true;
    } else if (event.type === "attempt:queued" && experiment && identity) {
      removeQueuedAttempt();
      experiment.attempts = [
        ...experiment.attempts,
        { evalId: identity.evalId, attempt: identity.attempt, state: "queued", reason: event.reason },
      ];
      this.refreshState(experiment);
      changed = true;
    } else if (event.type === "attempt:start" && experiment) {
      removeQueuedAttempt();
      experiment.queued = Math.max(0, experiment.queued - 1);
      experiment.running = experiment.running + 1;
      experiment.state = "running";
      if (identity !== undefined)
        experiment.activeAttempts = [
          ...experiment.activeAttempts,
          {
            evalId: identity.evalId,
            attemptOrdinal: identity.attempt + 1,
            phase: projectLifecyclePhase(event.phase ?? "sandbox.create"),
            phaseEnteredAt: new Date(event.at ?? Date.now()).toISOString(),
            sandbox: undefined,
            detail: undefined,
          },
        ];
      changed = true;
    } else if (event.type === "attempt:complete" && experiment) {
      experiment.activeAttempts = experiment.activeAttempts.filter((item) => item !== active);
      const completedWhileQueued = removeQueuedAttempt();
      if (completedWhileQueued) experiment.queued = Math.max(0, experiment.queued - 1);
      else experiment.running = Math.max(0, experiment.running - 1);
      this.refreshState(experiment);
      changed = true;
    } else if (event.type === "attempt:early-exit" && experiment) {
      removeQueuedAttempt();
      experiment.queued = Math.max(0, experiment.queued - 1);
      this.refreshState(experiment);
      changed = true;
    } else if (event.type === "lock-wait" && experiment) {
      if (event.status === "started") {
        const attempts = event.attempts ?? 1;
        experiment.queued = Math.max(0, experiment.queued - attempts);
        experiment.elsewhere = experiment.elsewhere + attempts;
        experiment.state = "waiting";
        changed = true;
      } else {
        const moved = (event.carried ?? 0) + (event.dispatched ?? 0);
        experiment.elsewhere = Math.max(0, experiment.elsewhere - moved);
        experiment.queued = experiment.queued + (event.dispatched ?? 0);
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

  private refreshState(experiment: ActiveSessionExperimentRecord): void {
    if (experiment.elsewhere > 0 && experiment.running === 0) {
      experiment.state = "waiting";
    } else if (experiment.running > 0 || experiment.queued > 0) {
      experiment.state = "running";
    } else {
      experiment.state = "teardown";
    }
  }

  /** 一次可观察的 heartbeat；显式调用者会收到本次 flush 的真实 I/O failure。 */
  heartbeat(): Effect.Effect<void, RunStorageCommandError> {
    return Effect.suspend(() => {
      if (!this.started || this.closed || this.record === undefined || this.record.status !== "active")
        return Effect.void;
      this.record.heartbeatAt = new Date().toISOString();
      return this.flush();
    });
  }

  /**
   * 完成最终 Session：先停止 heartbeat，再把完成 snapshot 排在所有既有反馈写之后。该收尾
   * 区域不可中断，避免 interruption 留下 active 条目或后台 Fiber。
   */
  close(input: SessionCloseInput = {}): Effect.Effect<SessionRecord | undefined, RunStorageCommandError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (!this.started || this.record === undefined || this.closed) return Effect.succeed(this.current);
        this.closed = true;
        const now = new Date().toISOString();
        const publishedRunIds = new Set(input.receipt?.createdRunIds ?? []);
        this.record = {
          sessionId: this.record.sessionId,
          pid: this.record.pid,
          startedAt: this.record.startedAt,
          status: sessionStatusOf(input.status),
          experiments: this.record.experiments.map((experiment) => ({
            experimentId: experiment.experimentId,
            runId: experiment.runId,
            lifecycle: "terminal",
            published: publishedRunIds.has(experiment.runId),
          })),
          completedAt: input.completedAt ?? now,
          completion: input.completion,
        };
        const snapshot = cloneRecord(this.record);
        const persistence = this.persistence;
        const persist = (
          persistence === undefined ? Effect.void : this.stopPersistenceEffect(persistence, Exit.void)
        ).pipe(Effect.andThen(this.persistTerminal(snapshot)));
        return persist.pipe(Effect.as(this.current));
      }),
    );
  }

  /** 按入队顺序强制写出当前 snapshot；worker 已关闭后退化为同一条 *Effect 原语的直接写。 */
  private flush(): Effect.Effect<void, RunStorageCommandError> {
    return Effect.suspend(() => {
      if (this.record === undefined) return Effect.void;
      const snapshot = cloneRecord(this.record);
      const persistence = this.persistence;
      return persistence !== undefined && persistence.accepting && !persistence.stopped
        ? this.offerWriteEffect(persistence, snapshot)
        : this.persistActive(snapshot);
    });
  }

  private enqueuePersist(): void {
    const persistence = this.persistence;
    if (this.record === undefined || persistence === undefined || !persistence.accepting || persistence.stopped) return;
    const snapshot = cloneRecord(this.record);
    // 反馈 API 受 coordinator 的同步 callback 契约限制，不能在这里启动 runtime。Queue 是
    // Effect worker 的同步入口；false 只会发生在 close 已关闭队列的竞态，此时最终 flush
    // 已覆盖当前 record。
    if (this.pendingObservation !== undefined) {
      this.pendingObservation.snapshot = snapshot;
      return;
    }
    const request: SessionObservationWrite = { _tag: "observe", snapshot };
    this.pendingObservation = request;
    if (!Queue.offerUnsafe(persistence.requests, request)) this.pendingObservation = undefined;
  }

  private persistenceWorkerEffect(requests: Queue.Queue<SessionPersistenceRequest>): Effect.Effect<void> {
    const handle = (request: SessionPersistenceRequest): Effect.Effect<void> => {
      if (request._tag === "barrier") {
        return Deferred.succeed(request.completion, undefined).pipe(Effect.asVoid);
      }
      if (request._tag === "observe") {
        if (this.pendingObservation === request) this.pendingObservation = undefined;
        return this.persistActive(request.snapshot).pipe(Effect.ignore);
      }
      // Each request owns a frozen snapshot. Capture the full Exit before
      // settling its waiter so a failed heartbeat cannot kill the serial
      // worker; a later state change is still allowed to retry the index write.
      return this.persistActive(request.snapshot).pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          request.completion === undefined ? Effect.void : Deferred.done(request.completion, exit).pipe(Effect.asVoid),
        ),
      );
    };
    return Effect.forever(Queue.take(requests).pipe(Effect.flatMap(handle))).pipe(
      // Queue shutdown interrupts its pending take. A different cause is a
      // broken worker invariant and stays a defect instead of being erased.
      Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.die(cause))),
    );
  }

  private persistActive(snapshot: SessionRecord): Effect.Effect<void, RunStorageCommandError> {
    const owner = this.owner;
    if (owner === undefined) return Effect.fail(normalizeExternalCause(new Error("Session owner is unavailable.")));
    const at =
      snapshot.status === "active" ? (snapshot.heartbeatAt ?? new Date().toISOString()) : new Date().toISOString();
    return this.invocationEffect<undefined>({
      _tag: "invocation-update-projection",
      invocationId: this.sessionId,
      owner,
      at,
      projection: encodeSession(snapshot),
      deadlineEpochMs: Date.now() + 30_000,
    });
  }

  private persistTerminal(snapshot: SessionRecord): Effect.Effect<void, RunStorageCommandError> {
    const owner = this.owner;
    if (owner === undefined) return Effect.fail(normalizeExternalCause(new Error("Session owner is unavailable.")));
    function terminalState() {
      switch (snapshot.status) {
        case "completed":
          return "completed" as const;
        case "interrupted":
          return "interrupted" as const;
        default:
          return "failed" as const;
      }
    }
    const state = terminalState();
    return this.invocationEffect<undefined>({
      _tag: "invocation-close",
      invocationId: this.sessionId,
      owner,
      state,
      at: "completedAt" in snapshot ? (snapshot.completedAt ?? new Date().toISOString()) : new Date().toISOString(),
      projection: encodeSession(snapshot),
      deadlineEpochMs: Date.now() + 30_000,
    });
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
  ): Effect.Effect<void, RunStorageCommandError> {
    this.pendingObservation = undefined;
    return Effect.gen(function* () {
      const completion = yield* Deferred.make<void, RunStorageCommandError>();
      const accepted = yield* Effect.sync(() =>
        Queue.offerUnsafe(persistence.requests, { _tag: "write", snapshot, completion }),
      );
      if (!accepted)
        return yield* Effect.fail(normalizeExternalCause(new Error("Session persistence queue closed before flush.")));
      yield* Deferred.await(completion);
    });
  }

  private barrierEffect(persistence: SessionPersistence): Effect.Effect<void, RunStorageCommandError> {
    this.pendingObservation = undefined;
    return Effect.gen(function* () {
      const completion = yield* Deferred.make<void, RunStorageCommandError>();
      const accepted = yield* Effect.sync(() =>
        Queue.offerUnsafe(persistence.requests, { _tag: "barrier", completion }),
      );
      if (!accepted)
        return yield* Effect.fail(normalizeExternalCause(new Error("Session persistence queue closed before drain.")));
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
  ): Effect.Effect<void, RunStorageCommandError> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (persistence.stopped) return Effect.void;
        persistence.accepting = false;
        const stopHeartbeat =
          persistence.heartbeat === undefined
            ? Effect.void
            : Fiber.interrupt(persistence.heartbeat).pipe(Effect.asVoid);
        const drain =
          finalSnapshot === undefined
            ? this.barrierEffect(persistence)
            : this.offerWriteEffect(persistence, finalSnapshot);
        return stopHeartbeat.pipe(
          Effect.andThen(drain),
          Effect.ensuring(this.releasePersistenceEffect(persistence, exit)),
        );
      }),
    );
  }

  private releasePersistenceEffect(
    persistence: SessionPersistence,
    exit: Exit.Exit<unknown, unknown>,
  ): Effect.Effect<void> {
    return Effect.uninterruptible(
      Effect.suspend(() => {
        if (persistence.stopped) return Effect.void;
        persistence.stopped = true;
        if (this.persistence === persistence) this.persistence = undefined;
        return Queue.shutdown(persistence.requests).pipe(Effect.andThen(Scope.close(persistence.scope, exit)));
      }),
    );
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
    heartbeatAt: record.status === "active" ? record.heartbeatAt : undefined,
  };
}

/** 完整读取边界跳过无法解码的 durable projections，不拖垮整个 ProjectDatabase 查询。 */
export function readSessions(
  niceevalRoot: string,
): Effect.Effect<SessionRecord[], RunStorageCommandError, ProjectStateDatabase> {
  return Effect.flatMap(ProjectStateDatabase, (database) =>
    Effect.flatMap(database.bind(niceevalRoot), (facets) =>
      Effect.tryPromise({
        try: () => facets.invocation.execute<readonly InvocationSessionRecord[]>({ _tag: "invocation-list" }),
        catch: sessionFailure,
      }),
    ),
  ).pipe(
    Effect.map((sessions) =>
      sessions
        .flatMap((session) => {
          const bytes = session.projection?.bytes;
          if (bytes === undefined) return [];
          const decoded = decodeSessionBytes(bytes);
          return decoded === undefined ? [] : [decoded];
        })
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    ),
  );
}

export interface SessionListOptions {
  readonly all?: boolean | undefined;
  readonly selector?: string | undefined;
  readonly nowMs?: number | undefined;
}

export function sessionListDocument(
  records: readonly SessionRecord[],
  options: SessionListOptions = {},
): SessionListDocument {
  const selector = options.selector;
  const matches = (record: SessionRecord): boolean =>
    selector === undefined || record.experiments.some((experiment) => experiment.experimentId.startsWith(selector));
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
  return { sessions, expired };
}

export function listSessions(
  niceevalRoot: string,
  options: SessionListOptions = {},
): Effect.Effect<SessionListDocument, RunStorageCommandError, ProjectStateDatabase> {
  return readSessions(niceevalRoot).pipe(Effect.map((records) => sessionListDocument(records, options)));
}

export function resolveSessionPrefix(records: readonly SessionRecord[], prefix: string): SessionRecord {
  const matches = records.filter((record) => record.sessionId === prefix || record.sessionId.startsWith(prefix));
  if (matches.length === 0) throw new Error(`No session matched: ${prefix}`);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous session prefix ${prefix}. Candidates: ${matches.map((record) => record.sessionId).join(", ")}`,
    );
  }
  return cloneRecord(matches[0]!);
}

export function showSession(
  niceevalRoot: string,
  prefix: string,
  nowMs = Date.now(),
): Effect.Effect<SessionShowDocument, RunStorageCommandError, ProjectStateDatabase> {
  return readSessions(niceevalRoot).pipe(
    Effect.map((records) => {
      const record = resolveSessionPrefix(records, prefix);
      const expired = isSessionExpired(record, nowMs);
      return {
        session: expired ? expiredProjection(record) : record,
        expired: expired ? true : undefined,
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

function renderExperimentLine(experiment: SessionExperimentRecord): string {
  if (experiment.published) {
    return `  ${experiment.experimentId}  niceeval show run:${experiment.runId}`;
  }
  if (experiment.lifecycle === "terminal") return `  ${experiment.experimentId}  @run:${shortRunId(experiment.runId)}`;
  const counters = [
    experiment.running ? `${experiment.running} running` : "",
    experiment.queued ? `${experiment.queued} queued` : "",
    experiment.elsewhere ? `${experiment.elsewhere} elsewhere` : "",
  ].filter(Boolean);
  return `  ${experiment.experimentId}  @run:${shortRunId(experiment.runId)}  ${experiment.state}${counters.length ? ` · ${counters.join(" · ")}` : ""}`;
}

export function renderSessionListText(document: SessionListDocument, nowMs = Date.now(), all = false): string {
  const lines: string[] = [
    `ACTIVE SESSIONS (${document.sessions.filter((session) => session.status === "active").length})`,
  ];
  const active = document.sessions.filter((session) => session.status === "active");
  if (active.length === 0) lines.push("(none)");
  for (const session of active) {
    lines.push(
      `${session.sessionId} · pid ${session.pid} · ${ageLabel(session.startedAt, nowMs)} · heartbeat ${ageLabel(session.heartbeatAt ?? session.startedAt, nowMs)}`,
    );
    lines.push(...session.experiments.map((experiment) => renderExperimentLine(experiment)));
  }
  if (all) {
    const completed = document.sessions.filter((session) => session.status !== "active");
    lines.push(`COMPLETED SESSIONS (${completed.length})`);
    if (completed.length === 0) lines.push("(none)");
    for (const session of completed) {
      lines.push(
        `${session.sessionId} · pid ${session.pid} · ${session.status} · completed ${session.completedAt ?? "—"}`,
      );
      lines.push(...session.experiments.map((experiment) => renderExperimentLine(experiment)));
    }
    if (document.expired.length > 0) {
      lines.push(`EXPIRED SESSIONS (${document.expired.length})`);
      for (const expired of document.expired) {
        lines.push(
          `${expired.sessionId} · pid ${expired.pid} · heartbeat ${expired.heartbeatAt ?? "unknown"} · ${`rerun the original command`}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderSessionShowText(document: SessionShowDocument): string {
  const session = document.session;
  const lines = [
    `SESSION ${session.sessionId}${document.expired ? " · EXPIRED" : ""}`,
    `pid ${session.pid} · started ${session.startedAt}`,
  ];
  if ("status" in session) {
    const completedAt = "completedAt" in session ? session.completedAt : undefined;
    lines.push(`status ${session.status}${completedAt ? ` · completed ${completedAt}` : ""}`);
  }
  if ("experiments" in session) {
    lines.push(
      ...session.experiments.flatMap((experiment) => [
        renderExperimentLine(experiment),
        ...(experiment.lifecycle === "active"
          ? experiment.activeAttempts.map(
              (attempt) =>
                `    ${attempt.evalId} #${attempt.attemptOrdinal} · ${projectLifecyclePhase(attempt.phase)} since ${attempt.phaseEnteredAt} · ${attempt.sandbox === undefined ? "no Sandbox" : `${attempt.sandbox.provider} ${attempt.sandbox.nativeInstanceId ?? "no native instance identifier"}`}\n      ${attempt.detail === undefined ? "no detail" : `${attempt.detail.at} ${attempt.detail.text}`}`,
            )
          : []),
      ]),
    );
  }
  if (document.expired) lines.push(`NEXT rerun the original command`);
  return `${lines.join("\n")}\n`;
}
