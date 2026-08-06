// Experiment Invocation 的轻量 Session 索引。
//
// Session 只回答「哪一批 Run 由同一次 exp 调度、当前是否仍活跃」；完整的
// Attempt / verdict / artifact 继续由 Run 记录保存。所有写入都走逐条目原子
// 文件原语，Session 不参与用例锁或实验级闸的判定。

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readAllEntryFiles, writeEntryFile } from "../shared/entry-file-store.ts";
import type { CompletionStatus, InvocationCompletion, RunFeedbackEvent, RunFeedbackState } from "./types.ts";
import type { AgentRun } from "./types.ts";

export const SESSION_HEARTBEAT_INTERVAL_MS = 10_000;
export const SESSION_EXPIRY_MS = 30_000;

export type SessionExperimentState = "setup" | "running" | "waiting" | "teardown";
export type SessionStatus = "active" | "completed" | "incomplete" | "interrupted";

export interface SessionExperimentRecord {
  experimentId: string;
  runId: string;
  state?: SessionExperimentState;
  running?: number;
  queued?: number;
  elsewhere?: number;
  path?: string;
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
  schemaVersion: 2;
  sessions: SessionRecord[];
  expired: ExpiredSessionRecord[];
}

export interface SessionShowDocument {
  format: "niceeval.session";
  schemaVersion: 2;
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
  completedAt?: string;
  /** `experimentId -> Run snapshot directory`;没有对应路径时省略。 */
  paths?: ReadonlyMap<string, string>;
}

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
  const state = raw.state;
  if (state !== undefined && state !== "setup" && state !== "running" && state !== "waiting" && state !== "teardown") {
    return undefined;
  }
  for (const key of ["running", "queued", "elsewhere"] as const) {
    if (raw[key] !== undefined && !isNonNegativeInteger(raw[key])) return undefined;
  }
  if (raw.path !== undefined && typeof raw.path !== "string") return undefined;
  const running = raw.running;
  const queued = raw.queued;
  const elsewhere = raw.elsewhere;
  const path = raw.path;
  return {
    experimentId: raw.experimentId,
    runId: raw.runId,
    ...(state !== undefined ? { state } : {}),
    ...(running !== undefined ? { running: running as number } : {}),
    ...(queued !== undefined ? { queued: queued as number } : {}),
    ...(elsewhere !== undefined ? { elsewhere: elsewhere as number } : {}),
    ...(path !== undefined ? { path } : {}),
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
    experiments: record.experiments.map((experiment) => ({ ...experiment })),
    ...(record.completion ? { completion: { ...record.completion, reporterErrors: [...record.completion.reporterErrors] } } : {}),
  };
}

/** 可持久化的 Session 生命周期；所有 fs 写入按调用顺序串行化。 */
export class SessionTracker {
  readonly niceevalRoot: string;
  readonly sessionId: string;
  private record: SessionRecord | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private started = false;
  private closed = false;

  constructor(niceevalRoot: string, sessionId = `s_${randomUUID()}`) {
    this.niceevalRoot = niceevalRoot;
    this.sessionId = sessionId;
  }

  get current(): SessionRecord | undefined {
    return this.record === undefined ? undefined : cloneRecord(this.record);
  }

  async start(input: SessionStartInput): Promise<SessionRecord> {
    if (this.started) throw new Error("SessionTracker.start() called more than once.");
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
    await this.persist();
    this.timer = setInterval(() => {
      void this.heartbeat();
    }, SESSION_HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
    return this.current!;
  }

  /** coordinator 的事件回调；只维护 Session 索引允许的最小状态。 */
  onFeedback(event: RunFeedbackEvent, _state?: RunFeedbackState): void {
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
    if (event.type === "attempt:start" && experiment) {
      experiment.queued = Math.max(0, (experiment.queued ?? 0) - 1);
      experiment.running = (experiment.running ?? 0) + 1;
      experiment.state = "running";
      changed = true;
    } else if (event.type === "attempt:complete" && experiment) {
      experiment.running = Math.max(0, (experiment.running ?? 0) - 1);
      this.refreshState(experiment);
      changed = true;
    } else if (event.type === "attempt:early-exit" && experiment) {
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

  async heartbeat(): Promise<void> {
    if (!this.started || this.closed || this.record === undefined || this.record.status !== "active") return;
    this.record.heartbeatAt = new Date().toISOString();
    this.enqueuePersist();
    await this.writes;
  }

  async close(input: SessionCloseInput = {}): Promise<SessionRecord | undefined> {
    if (!this.started || this.record === undefined || this.closed) return this.current;
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    const now = new Date().toISOString();
    this.record.status = sessionStatusOf(input.status);
    this.record.completedAt = input.completedAt ?? now;
    delete this.record.heartbeatAt;
    if (input.completion !== undefined) this.record.completion = input.completion;
    for (const experiment of this.record.experiments) {
      const path = input.paths?.get(experiment.experimentId);
      delete experiment.state;
      delete experiment.running;
      delete experiment.queued;
      delete experiment.elsewhere;
      if (path !== undefined) experiment.path = path;
    }
    this.enqueuePersist();
    await this.writes;
    return this.current;
  }

  private enqueuePersist(): void {
    if (this.record === undefined) return;
    const snapshot = cloneRecord(this.record);
    // Session 是可观测索引；单次心跳写失败不应制造 unhandled rejection 或改变 attempt
    // 判定。下一次心跳/状态变化会再次尝试写入。
    this.writes = this.writes
      .catch(() => undefined)
      .then(() => writeEntryFile(sessionsDirOf(this.niceevalRoot), this.sessionId, snapshot));
  }

  private async persist(): Promise<void> {
    if (this.record === undefined) return;
    await writeEntryFile(sessionsDirOf(this.niceevalRoot), this.sessionId, cloneRecord(this.record));
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

export async function readSessions(niceevalRoot: string): Promise<SessionRecord[]> {
  const entries = await readAllEntryFiles(sessionsDirOf(niceevalRoot), decodeSession);
  return entries.map(({ entry }) => entry).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
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
  return { format: "niceeval.sessions", schemaVersion: 2, sessions, expired };
}

export async function listSessions(
  niceevalRoot: string,
  options: { all?: boolean; selector?: string; nowMs?: number } = {},
): Promise<SessionListDocument> {
  return sessionListDocument(await readSessions(niceevalRoot), options);
}

export function resolveSessionPrefix(records: readonly SessionRecord[], prefix: string): SessionRecord {
  const matches = records.filter((record) => record.sessionId === prefix || record.sessionId.startsWith(prefix));
  if (matches.length === 0) throw new Error(`No session matched: ${prefix}`);
  if (matches.length > 1) {
    throw new Error(`Ambiguous session prefix ${prefix}. Candidates: ${matches.map((record) => record.sessionId).join(", ")}`);
  }
  return cloneRecord(matches[0]!);
}

export async function showSession(niceevalRoot: string, prefix: string, nowMs = Date.now()): Promise<SessionShowDocument> {
  const record = resolveSessionPrefix(await readSessions(niceevalRoot), prefix);
  const expired = isSessionExpired(record, nowMs);
  return {
    format: "niceeval.session",
    schemaVersion: 2,
    session: expired ? expiredProjection(record) : record,
    ...(expired ? { expired: true } : {}),
  };
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
  if (experiment.path !== undefined) {
    return `  ${experiment.experimentId}  @run:${shortRunId(experiment.runId)}  ${experiment.path}`;
  }
  const counters = [
    experiment.running ? `${experiment.running} running` : "",
    experiment.queued ? `${experiment.queued} queued` : "",
    experiment.elsewhere ? `${experiment.elsewhere} elsewhere` : "",
  ].filter(Boolean);
  return `  ${experiment.experimentId}  @run:${shortRunId(experiment.runId)}  ${experiment.state ?? "running"}${counters.length ? ` · ${counters.join(" · ")}` : ""}`;
}

export function renderSessionListText(document: SessionListDocument, nowMs = Date.now(), all = false): string {
  const lines: string[] = [`ACTIVE SESSIONS (${document.sessions.filter((session) => session.status === "active").length})`];
  const active = document.sessions.filter((session) => session.status === "active");
  if (active.length === 0) lines.push("(none)");
  for (const session of active) {
    lines.push(`${session.sessionId} · pid ${session.pid} · ${ageLabel(session.startedAt, nowMs)} · heartbeat ${ageLabel(session.heartbeatAt ?? session.startedAt, nowMs)}`);
    lines.push(...session.experiments.map(renderExperimentLine));
  }
  if (all) {
    const completed = document.sessions.filter((session) => session.status !== "active");
    lines.push(`COMPLETED SESSIONS (${completed.length})`);
    if (completed.length === 0) lines.push("(none)");
    for (const session of completed) {
      lines.push(`${session.sessionId} · pid ${session.pid} · ${session.status} · completed ${session.completedAt ?? "—"}`);
      lines.push(...session.experiments.map(renderExperimentLine));
    }
    if (document.expired.length > 0) {
      lines.push(`EXPIRED SESSIONS (${document.expired.length})`);
      for (const expired of document.expired) {
        lines.push(`${expired.sessionId} · pid ${expired.pid} · heartbeat ${expired.heartbeatAt ?? "unknown"} · 重新运行原命令`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderSessionShowText(document: SessionShowDocument): string {
  const session = document.session;
  const lines = [`SESSION ${session.sessionId}${document.expired ? " · EXPIRED" : ""}`, `pid ${session.pid} · started ${session.startedAt}`];
  if ("status" in session) lines.push(`status ${session.status}${session.completedAt ? ` · completed ${session.completedAt}` : ""}`);
  if ("experiments" in session) lines.push(...session.experiments.map(renderExperimentLine));
  if (document.expired) lines.push("NEXT 重新运行原命令");
  return `${lines.join("\n")}\n`;
}
