import type { SQLOutputValue } from "node:sqlite";
import { recordStatement, type RecordDatabase } from "./database.ts";
import { sqliteError } from "../../record/sqlite/errors.ts";
import { withImmediateTransaction } from "./transaction.ts";

type Row = Readonly<Record<string, SQLOutputValue>>;

export interface ProcessOwnerIdentity {
  readonly ownerId: string;
  readonly host: string;
  readonly pid: number;
  readonly bootId: string;
  readonly processStart: string;
}

export interface FencedOwner extends ProcessOwnerIdentity {
  readonly generation: number;
}

export interface CaseLockProjection {
  readonly owner: FencedOwner;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
}

export interface InvocationRunInput {
  readonly runId: string;
  readonly experimentId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly expectedSlots: readonly {
    readonly slotId: string;
    readonly evalId: string;
    readonly attemptOrdinal: number;
    readonly executionIdentityDigest: string;
  }[];
}

export interface CreateInvocationInput {
  readonly invocationId: string;
  readonly owner: ProcessOwnerIdentity;
  readonly startedAt: string;
  readonly runs: readonly InvocationRunInput[];
  readonly queuedAttempts?: readonly {
    readonly attemptId: string;
    readonly runId: string;
    readonly slotId: string;
  }[];
  readonly deadlineEpochMs: number;
}

export type InvocationSessionState = "active" | "recovering" | "completed" | "interrupted" | "failed";

export interface InvocationSessionRecord {
  readonly invocationId: string;
  readonly state: InvocationSessionState;
  readonly owner: FencedOwner;
  readonly startedAt: string;
  readonly heartbeatAt: string;
  readonly recoveringAt?: string;
  readonly closedAt?: string;
  readonly activeProjection?: Uint8Array;
  readonly terminalProjection?: Uint8Array;
}

function conflict(operation: string, message: string): never {
  throw sqliteError("record-command-conflict", operation, message);
}

function invalid(operation: string, message: string): never {
  throw sqliteError("record-database-invalid", operation, message);
}

function text(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") invalid("coordination-decode", `${field} is not text`);
  return value;
}

function integer(row: Row, field: string): number {
  const value = row[field];
  const decoded = typeof value === "bigint" ? Number(value) : value;
  if (typeof decoded !== "number" || !Number.isSafeInteger(decoded)) invalid("coordination-decode", `${field} is not an integer`);
  return decoded;
}

function requireOpen(connection: RecordDatabase, operation: string): void {
  const row = recordStatement(connection, "SELECT barrier_state FROM record_metadata WHERE singleton=1").get() as Row | undefined;
  if (row === undefined || text(row, "barrier_state") !== "open") conflict(operation, "ProjectDatabase writer barrier is not open");
}

function sameOwnerSql(prefix: string): string {
  return `${prefix}_id=? AND ${prefix}_generation=? AND ${prefix}_host=? AND ${prefix}_pid=? AND ${prefix}_boot_id=? AND ${prefix}_process_start=?`;
}

function ownerArgs(owner: FencedOwner): readonly (string | number)[] {
  return [owner.ownerId, owner.generation, owner.host, owner.pid, owner.bootId, owner.processStart];
}

function decodeSession(row: Row): InvocationSessionRecord {
  const active = row.active_projection;
  const terminal = row.terminal_projection;
  return Object.freeze({
    invocationId: text(row, "invocation_id"),
    state: text(row, "state") as InvocationSessionState,
    owner: Object.freeze({
      ownerId: text(row, "owner_id"), generation: integer(row, "owner_generation"),
      host: text(row, "owner_host"), pid: integer(row, "owner_pid"),
      bootId: text(row, "owner_boot_id"), processStart: text(row, "owner_process_start"),
    }),
    startedAt: text(row, "started_at"), heartbeatAt: text(row, "heartbeat_at"),
    ...(typeof row.recovering_at === "string" ? { recoveringAt: row.recovering_at } : {}),
    ...(typeof row.closed_at === "string" ? { closedAt: row.closed_at } : {}),
    ...(active instanceof Uint8Array ? { activeProjection: new Uint8Array(active) } : {}),
    ...(terminal instanceof Uint8Array ? { terminalProjection: new Uint8Array(terminal) } : {}),
  });
}

export function createInvocationOnConnection(connection: RecordDatabase, input: CreateInvocationInput): InvocationSessionRecord {
  return withImmediateTransaction(connection, input.deadlineEpochMs, "create-invocation", () => {
    requireOpen(connection, "create-invocation");
    recordStatement(connection, `INSERT INTO invocation_sessions(invocation_id,state,owner_id,owner_generation,
      owner_host,owner_pid,owner_boot_id,owner_process_start,started_at,heartbeat_at,recovering_at,closed_at,active_projection,terminal_projection)
      VALUES (?,'active',?,1,?,?,?,?,?, ?,NULL,NULL,NULL,NULL)`).run(
      input.invocationId, input.owner.ownerId, input.owner.host, input.owner.pid, input.owner.bootId,
      input.owner.processStart, input.startedAt, input.startedAt,
    );
    const insertRun = recordStatement(connection, `INSERT INTO run_resources(run_id,invocation_id,experiment_id,started_at,
      initial_writer_generation,current_writer_generation,terminal_state,completed_at,created_revision,close_revision)
      VALUES (?,?,?,?,?,?,NULL,NULL,?,NULL)`);
    const insertExperiment = recordStatement(connection, `INSERT INTO invocation_session_experiments(invocation_id,experiment_id,run_id,ordinal)
      VALUES (?,?,?,?)`);
    const insertSlot = recordStatement(connection, `INSERT INTO run_expected_slots(run_id,slot_id,ordinal,eval_id,attempt_ordinal,execution_identity_digest)
      VALUES (?,?,?,?,?,?)`);
    input.runs.forEach((run, runOrdinal) => {
      recordStatement(connection, "UPDATE run_publication_clock SET revision=revision+1 WHERE singleton=1").run();
      const revision = recordStatement(connection, "SELECT revision FROM run_publication_clock WHERE singleton=1").get() as Row;
      insertRun.run(run.runId, input.invocationId, run.experimentId, run.startedAt, run.writerGeneration, run.writerGeneration, integer(revision, "revision"));
      insertExperiment.run(input.invocationId, run.experimentId, run.runId, runOrdinal);
      run.expectedSlots.forEach((slot, ordinal) => insertSlot.run(run.runId, slot.slotId, ordinal, slot.evalId, slot.attemptOrdinal, slot.executionIdentityDigest));
    });
    const insertQueued = recordStatement(connection, `INSERT INTO invocation_session_queued_attempts(invocation_id,attempt_id,run_id,slot_id,ordinal)
      VALUES (?,?,?,?,?)`);
    (input.queuedAttempts ?? []).forEach((attempt, ordinal) => insertQueued.run(input.invocationId, attempt.attemptId, attempt.runId, attempt.slotId, ordinal));
    return readInvocationOnConnection(connection, input.invocationId)!;
  });
}

export function readInvocationOnConnection(connection: RecordDatabase, invocationId: string): InvocationSessionRecord | undefined {
  const row = recordStatement(connection, "SELECT * FROM invocation_sessions WHERE invocation_id=?").get(invocationId) as Row | undefined;
  return row === undefined ? undefined : decodeSession(row);
}

export function listInvocationsOnConnection(connection: RecordDatabase): readonly InvocationSessionRecord[] {
  return Object.freeze((recordStatement(connection, "SELECT * FROM invocation_sessions ORDER BY started_at,invocation_id").all() as unknown as readonly Row[]).map(decodeSession));
}

export function heartbeatInvocationOnConnection(connection: RecordDatabase, invocationId: string, owner: FencedOwner, at: string, deadline: number): void {
  withImmediateTransaction(connection, deadline, "heartbeat-invocation", () => {
    requireOpen(connection, "heartbeat-invocation");
    const changed = recordStatement(connection, `UPDATE invocation_sessions SET heartbeat_at=? WHERE invocation_id=? AND state='active' AND ${sameOwnerSql("owner")}`)
      .run(at, invocationId, ...ownerArgs(owner));
    if (Number(changed.changes) !== 1) conflict("heartbeat-invocation", "invocation owner generation is fenced");
  });
}

export function updateInvocationActiveProjectionOnConnection(
  connection: RecordDatabase,
  invocationId: string,
  owner: FencedOwner,
  at: string,
  projection: Uint8Array,
  deadline: number,
): void {
  withImmediateTransaction(connection, deadline, "update-invocation-active-projection", () => {
    requireOpen(connection, "update-invocation-active-projection");
    const changed = recordStatement(connection, `UPDATE invocation_sessions SET heartbeat_at=?,active_projection=?
      WHERE invocation_id=? AND state='active' AND ${sameOwnerSql("owner")}`)
      .run(at, projection, invocationId, ...ownerArgs(owner));
    if (Number(changed.changes) !== 1) conflict("update-invocation-active-projection", "invocation owner generation is fenced");
  });
}

export function queueInvocationAttemptOnConnection(connection: RecordDatabase, invocationId: string, owner: FencedOwner, attempt: {
  readonly attemptId: string;
  readonly runId: string;
  readonly slotId: string;
  readonly ordinal: number;
}, at: string, deadline: number): void {
  withImmediateTransaction(connection, deadline, "queue-invocation-attempt", () => {
    requireOpen(connection, "queue-invocation-attempt");
    const heartbeat = recordStatement(connection, `UPDATE invocation_sessions SET heartbeat_at=?
      WHERE invocation_id=? AND state='active' AND ${sameOwnerSql("owner")}`).run(at, invocationId, ...ownerArgs(owner));
    if (Number(heartbeat.changes) !== 1) conflict("queue-invocation-attempt", "invocation owner generation is fenced");
    recordStatement(connection, `INSERT INTO invocation_session_queued_attempts(invocation_id,attempt_id,run_id,slot_id,ordinal)
      VALUES (?,?,?,?,?)`).run(invocationId, attempt.attemptId, attempt.runId, attempt.slotId, attempt.ordinal);
  });
}

export function finishInvocationAttemptOnConnection(connection: RecordDatabase, invocationId: string, owner: FencedOwner, attemptId: string, at: string, deadline: number): void {
  withImmediateTransaction(connection, deadline, "finish-invocation-attempt", () => {
    requireOpen(connection, "finish-invocation-attempt");
    const heartbeat = recordStatement(connection, `UPDATE invocation_sessions SET heartbeat_at=?
      WHERE invocation_id=? AND state='active' AND ${sameOwnerSql("owner")}`).run(at, invocationId, ...ownerArgs(owner));
    if (Number(heartbeat.changes) !== 1) conflict("finish-invocation-attempt", "invocation owner generation is fenced");
    const removed = recordStatement(connection, "DELETE FROM invocation_session_queued_attempts WHERE invocation_id=? AND attempt_id=?")
      .run(invocationId, attemptId);
    if (Number(removed.changes) !== 1) conflict("finish-invocation-attempt", "queued attempt does not exist");
  });
}

export function beginInvocationRecoveryOnConnection(connection: RecordDatabase, invocationId: string, deadOwner: FencedOwner, recoveryOwner: ProcessOwnerIdentity, at: string, deadline: number): FencedOwner {
  return withImmediateTransaction(connection, deadline, "begin-invocation-recovery", () => {
    requireOpen(connection, "begin-invocation-recovery");
    const changed = recordStatement(connection, `UPDATE invocation_sessions SET state='recovering',recovering_at=?,owner_id=?,
      owner_generation=owner_generation+1,owner_host=?,owner_pid=?,owner_boot_id=?,owner_process_start=?,heartbeat_at=?
      WHERE invocation_id=? AND state='active' AND ${sameOwnerSql("owner")}`).run(
      at, recoveryOwner.ownerId, recoveryOwner.host, recoveryOwner.pid, recoveryOwner.bootId, recoveryOwner.processStart, at,
      invocationId, ...ownerArgs(deadOwner),
    );
    if (Number(changed.changes) !== 1) conflict("begin-invocation-recovery", "exact dead invocation owner did not match");
    return Object.freeze({ ...recoveryOwner, generation: deadOwner.generation + 1 });
  });
}

export function closeInvocationOnConnection(connection: RecordDatabase, invocationId: string, owner: FencedOwner, state: Exclude<InvocationSessionState, "active" | "recovering">, at: string, projection: Uint8Array, deadline: number): void {
  withImmediateTransaction(connection, deadline, "close-invocation", () => {
    requireOpen(connection, "close-invocation");
    const changed = recordStatement(connection, `UPDATE invocation_sessions SET state=?,closed_at=?,active_projection=NULL,terminal_projection=?,recovering_at=NULL
      WHERE invocation_id=? AND state IN ('active','recovering') AND ${sameOwnerSql("owner")}`).run(state, at, projection, invocationId, ...ownerArgs(owner));
    if (Number(changed.changes) !== 1) conflict("close-invocation", "invocation owner generation is fenced or terminal");
    recordStatement(connection, "DELETE FROM invocation_session_queued_attempts WHERE invocation_id=?").run(invocationId);
  });
}

export function finishInvocationRecoveryOnConnection(connection: RecordDatabase, invocationId: string, owner: FencedOwner, at: string, projection: Uint8Array, deadline: number): void {
  closeInvocationOnConnection(connection, invocationId, owner, "interrupted", at, projection, deadline);
}

export function acquireCaseLockOnConnection(connection: RecordDatabase, caseId: string, owner: ProcessOwnerIdentity, at: string, deadline: number): FencedOwner {
  return withImmediateTransaction(connection, deadline, "acquire-case-lock", () => {
    requireOpen(connection, "acquire-case-lock");
    const existing = recordStatement(connection, "SELECT * FROM case_locks WHERE case_id=?").get(caseId) as Row | undefined;
    if (existing !== undefined) conflict("acquire-case-lock", `case ${caseId} is already owned`);
    recordStatement(connection, `INSERT INTO case_locks(case_id,owner_id,owner_generation,owner_host,owner_pid,owner_boot_id,owner_process_start,acquired_at,heartbeat_at)
      VALUES (?,?,1,?,?,?,?,?,?)`).run(caseId, owner.ownerId, owner.host, owner.pid, owner.bootId, owner.processStart, at, at);
    return Object.freeze({ ...owner, generation: 1 });
  });
}

export function readCaseLockProjectionOnConnection(connection: RecordDatabase, caseId: string): CaseLockProjection | undefined {
  const row = recordStatement(connection, "SELECT * FROM case_locks WHERE case_id=?").get(caseId) as Row | undefined;
  return row === undefined ? undefined : Object.freeze({
    owner: Object.freeze({
      ownerId: text(row, "owner_id"), generation: integer(row, "owner_generation"),
      host: text(row, "owner_host"), pid: integer(row, "owner_pid"),
      bootId: text(row, "owner_boot_id"), processStart: text(row, "owner_process_start"),
    }),
    acquiredAt: text(row, "acquired_at"),
    heartbeatAt: text(row, "heartbeat_at"),
  });
}

export function readCaseLockOnConnection(connection: RecordDatabase, caseId: string): FencedOwner | undefined {
  return readCaseLockProjectionOnConnection(connection, caseId)?.owner;
}

export function heartbeatCaseLockOnConnection(connection: RecordDatabase, caseId: string, owner: FencedOwner, at: string, deadline: number): void {
  withImmediateTransaction(connection, deadline, "heartbeat-case-lock", () => {
    requireOpen(connection, "heartbeat-case-lock");
    const changed = recordStatement(connection, `UPDATE case_locks SET heartbeat_at=? WHERE case_id=? AND ${sameOwnerSql("owner")}`).run(at, caseId, ...ownerArgs(owner));
    if (Number(changed.changes) !== 1) conflict("heartbeat-case-lock", "case lock owner generation is fenced");
  });
}

export function releaseCaseLockOnConnection(connection: RecordDatabase, caseId: string, owner: FencedOwner, deadline: number): void {
  withImmediateTransaction(connection, deadline, "release-case-lock", () => {
    requireOpen(connection, "release-case-lock");
    const changed = recordStatement(connection, `DELETE FROM case_locks WHERE case_id=? AND ${sameOwnerSql("owner")}`).run(caseId, ...ownerArgs(owner));
    if (Number(changed.changes) !== 1) conflict("release-case-lock", "case lock owner generation is fenced");
  });
}

export function takeoverDeadCaseLockOnConnection(connection: RecordDatabase, caseId: string, deadOwner: FencedOwner, replacement: ProcessOwnerIdentity, at: string, deadline: number): FencedOwner {
  return withImmediateTransaction(connection, deadline, "takeover-case-lock", () => {
    requireOpen(connection, "takeover-case-lock");
    const changed = recordStatement(connection, `UPDATE case_locks SET owner_id=?,owner_generation=owner_generation+1,owner_host=?,owner_pid=?,
      owner_boot_id=?,owner_process_start=?,acquired_at=?,heartbeat_at=? WHERE case_id=? AND ${sameOwnerSql("owner")}`).run(
      replacement.ownerId, replacement.host, replacement.pid, replacement.bootId, replacement.processStart, at, at,
      caseId, ...ownerArgs(deadOwner),
    );
    if (Number(changed.changes) !== 1) conflict("takeover-case-lock", "exact dead case owner did not match");
    return Object.freeze({ ...replacement, generation: deadOwner.generation + 1 });
  });
}
