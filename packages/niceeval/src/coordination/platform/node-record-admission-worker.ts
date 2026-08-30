import { accessSync } from "node:fs";
import { hostname } from "node:os";
import { isMainThread, parentPort } from "node:worker_threads";
import {
  closeRecordDatabase,
  openRecordMaintenance,
  validateExactSchema,
  type RecordDatabase,
} from "../../record/sqlite/database.ts";
import { sqliteError } from "../../record/sqlite/errors.ts";
import { withImmediateTransaction } from "../../record/sqlite/transaction.ts";
import type {
  AdmissionRequest,
  AdmissionResponse,
  EnqueueResult,
} from "./node-record-admission-protocol.ts";

const MAXIMUM_STALE_HEADS_PER_TRANSACTION = 16;
const connections = new Map<string, RecordDatabase>();

interface WriterOwner {
  readonly ticketId: string;
  readonly sequence: number;
  readonly host: string;
  readonly pid: number;
  readonly deadline: number;
  readonly nonce: string;
  readonly leaseExpiresAt: number;
}

interface BarrierOwner {
  readonly barrierId: string;
  readonly nonce: string;
  readonly host: string;
  readonly pid: number;
  readonly deadline: number;
  readonly leaseExpiresAt: number;
  readonly status: "requested" | "active";
}

interface CoordinationState {
  readonly nextWriterSequence: number;
  readonly writer: WriterOwner | undefined;
  readonly barrier: BarrierOwner | undefined;
}

interface WaitingTicket {
  readonly ticketId: string;
  readonly sequence: number;
  readonly host: string;
  readonly pid: number;
  readonly deadline: number;
  readonly enqueuedAt: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function hasOwner(value: Record<string, unknown>): boolean {
  return typeof value.host === "string" && value.host.length > 0 && isPositiveInteger(value.pid);
}

function hasPathAndDeadline(value: Record<string, unknown>): boolean {
  return typeof value.path === "string" && value.path.length > 0 && isPositiveInteger(value.deadline);
}

function isAdmissionRequest(value: unknown): value is AdmissionRequest {
  if (!isObject(value) || !isPositiveInteger(value.id) || typeof value.operation !== "string") {
    return false;
  }
  if (value.operation === "close") return true;
  if (!hasPathAndDeadline(value) || !hasOwner(value)) return false;
  switch (value.operation) {
    case "enqueue":
      return typeof value.ticketId === "string" && value.ticketId.length > 0 &&
        isPositiveInteger(value.enqueuedAt);
    case "try-admit":
      return typeof value.ticketId === "string" && value.ticketId.length > 0 &&
        isPositiveInteger(value.sequence) && isPositiveInteger(value.now);
    case "cancel-writer":
      return typeof value.ticketId === "string" && value.ticketId.length > 0 &&
        isPositiveInteger(value.now);
    case "release-writer":
      return typeof value.ticketId === "string" && value.ticketId.length > 0 &&
        isPositiveInteger(value.sequence) && isPositiveInteger(value.now);
    case "request-barrier":
      return typeof value.barrierId === "string" && value.barrierId.length > 0 &&
        typeof value.nonce === "string" && value.nonce.length > 0 &&
        isPositiveInteger(value.requestedAt);
    case "try-activate-barrier":
    case "cancel-barrier":
      return typeof value.barrierId === "string" && value.barrierId.length > 0 &&
        typeof value.nonce === "string" && value.nonce.length > 0 &&
        isPositiveInteger(value.now);
    default:
      return false;
  }
}

function invalid(operation: string, message: string): never {
  throw sqliteError("record-database-invalid", operation, message);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid("coordination", `${field} is invalid`);
  return value;
}

function integer(value: unknown, field: string): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number)) invalid("coordination", `${field} is invalid`);
  return Number(number);
}

function positiveInteger(value: unknown, field: string): number {
  const number = integer(value, field);
  if (number <= 0) invalid("coordination", `${field} is invalid`);
  return number;
}

function connectionFor(path: string): RecordDatabase {
  const cached = connections.get(path);
  if (cached !== undefined) return cached;
  accessSync(path);
  const connection = openRecordMaintenance(path);
  try {
    validateExactSchema(connection);
  } catch (cause) {
    closeRecordDatabase(connection);
    throw cause;
  }
  connections.set(path, connection);
  return connection;
}

function closeConnections(): void {
  for (const connection of connections.values()) closeRecordDatabase(connection);
  connections.clear();
}

function isLocalProcessDead(ownerHost: string, pid: number): boolean {
  if (ownerHost !== hostname()) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function waitingTicket(row: Record<string, unknown> | undefined): WaitingTicket | undefined {
  if (row === undefined) return undefined;
  return {
    ticketId: text(row.ticket_id, "coordination_tickets.ticket_id"),
    sequence: positiveInteger(row.sequence, "coordination_tickets.sequence"),
    host: text(row.host, "coordination_tickets.host"),
    pid: positiveInteger(row.pid, "coordination_tickets.pid"),
    deadline: positiveInteger(row.deadline, "coordination_tickets.deadline"),
    enqueuedAt: positiveInteger(row.enqueued_at, "coordination_tickets.enqueued_at"),
  };
}

function coordinationState(connection: RecordDatabase): CoordinationState {
  const row = connection.db.prepare("SELECT * FROM coordination_state WHERE singleton=1").get() as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) invalid("coordination", "coordination_state singleton is missing");

  const writerTicketId = row.writer_ticket_id;
  const writer = writerTicketId === null
    ? undefined
    : {
        ticketId: text(writerTicketId, "coordination_state.writer_ticket_id"),
        sequence: positiveInteger(row.writer_sequence, "coordination_state.writer_sequence"),
        host: text(row.writer_host, "coordination_state.writer_host"),
        pid: positiveInteger(row.writer_pid, "coordination_state.writer_pid"),
        deadline: positiveInteger(row.writer_deadline, "coordination_state.writer_deadline"),
        nonce: text(row.writer_nonce, "coordination_state.writer_nonce"),
        leaseExpiresAt: positiveInteger(
          row.writer_lease_expires_at,
          "coordination_state.writer_lease_expires_at",
        ),
      };

  const barrierId = row.barrier_id;
  let barrier: BarrierOwner | undefined;
  if (barrierId !== null) {
    const status = row.barrier_status;
    if (status !== "requested" && status !== "active") {
      invalid("coordination", "coordination_state.barrier_status is invalid");
    }
    barrier = {
      barrierId: text(barrierId, "coordination_state.barrier_id"),
      nonce: text(row.barrier_nonce, "coordination_state.barrier_nonce"),
      host: text(row.barrier_host, "coordination_state.barrier_host"),
      pid: positiveInteger(row.barrier_pid, "coordination_state.barrier_pid"),
      deadline: positiveInteger(row.barrier_deadline, "coordination_state.barrier_deadline"),
      leaseExpiresAt: positiveInteger(
        row.barrier_lease_expires_at,
        "coordination_state.barrier_lease_expires_at",
      ),
      status,
    };
  }
  return {
    nextWriterSequence: positiveInteger(
      row.next_writer_sequence,
      "coordination_state.next_writer_sequence",
    ),
    writer,
    barrier,
  };
}

function clearWriter(connection: RecordDatabase, owner: WriterOwner): void {
  const result = connection.db.prepare(`UPDATE coordination_state SET
    writer_ticket_id=NULL,writer_sequence=NULL,writer_host=NULL,writer_pid=NULL,
    writer_deadline=NULL,writer_enqueued_at=NULL,writer_nonce=NULL,
    writer_admitted_at=NULL,writer_lease_expires_at=NULL,revision=revision+1
    WHERE singleton=1 AND writer_ticket_id=? AND writer_sequence=? AND writer_nonce=?`)
    .run(owner.ticketId, owner.sequence, owner.nonce);
  if (Number(result.changes) !== 1) invalid("coordination", "writer owner changed while clearing");
}

function clearBarrier(connection: RecordDatabase, owner: BarrierOwner): void {
  const result = connection.db.prepare(`UPDATE coordination_state SET
    barrier_id=NULL,barrier_nonce=NULL,barrier_host=NULL,barrier_pid=NULL,
    barrier_deadline=NULL,barrier_requested_at=NULL,barrier_lease_expires_at=NULL,
    barrier_status=NULL,barrier_active_at=NULL,revision=revision+1
    WHERE singleton=1 AND barrier_id=? AND barrier_nonce=?`)
    .run(owner.barrierId, owner.nonce);
  if (Number(result.changes) !== 1) invalid("coordination", "write freeze changed while clearing");
}

function recover(connection: RecordDatabase, now: number): void {
  connection.db.prepare("DELETE FROM coordination_tickets WHERE deadline <= ?").run(now);
  for (let count = 0; count < MAXIMUM_STALE_HEADS_PER_TRANSACTION; count += 1) {
    const head = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,deadline,enqueued_at
      FROM coordination_tickets ORDER BY sequence LIMIT 1`).get() as
        | Record<string, unknown>
        | undefined);
    if (head === undefined || !isLocalProcessDead(head.host, head.pid)) break;
    connection.db.prepare("DELETE FROM coordination_tickets WHERE ticket_id=? AND sequence=?")
      .run(head.ticketId, head.sequence);
  }

  const state = coordinationState(connection);
  if (state.writer !== undefined &&
    (state.writer.deadline <= now || state.writer.leaseExpiresAt <= now ||
      isLocalProcessDead(state.writer.host, state.writer.pid))) {
    clearWriter(connection, state.writer);
  }
  if (state.barrier !== undefined &&
    (state.barrier.deadline <= now || state.barrier.leaseExpiresAt <= now ||
      isLocalProcessDead(state.barrier.host, state.barrier.pid))) {
    clearBarrier(connection, state.barrier);
  }
}

function sameWriter(owner: WriterOwner, request: {
  readonly ticketId: string;
  readonly sequence: number;
  readonly host: string;
  readonly pid: number;
}): boolean {
  return owner.ticketId === request.ticketId && owner.sequence === request.sequence &&
    owner.host === request.host && owner.pid === request.pid && owner.nonce === request.ticketId;
}

function sameBarrier(owner: BarrierOwner, request: {
  readonly barrierId: string;
  readonly nonce: string;
  readonly host: string;
  readonly pid: number;
}): boolean {
  return owner.barrierId === request.barrierId && owner.nonce === request.nonce &&
    owner.host === request.host && owner.pid === request.pid;
}

function runEnqueue(
  connection: RecordDatabase,
  request: Extract<AdmissionRequest, { readonly operation: "enqueue" }>,
): EnqueueResult {
  recover(connection, request.enqueuedAt);
  const existing = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,deadline,enqueued_at
    FROM coordination_tickets WHERE ticket_id=?`).get(request.ticketId) as
      | Record<string, unknown>
      | undefined);
  if (existing !== undefined) {
    if (existing.host !== request.host || existing.pid !== request.pid ||
      existing.deadline !== request.deadline) {
      invalid(request.operation, "writer ticket identity changed");
    }
    return { state: "queued", sequence: existing.sequence };
  }
  const state = coordinationState(connection);
  if (state.barrier !== undefined) return { state: "blocked-by-barrier" };
  if (state.nextWriterSequence >= Number.MAX_SAFE_INTEGER) {
    invalid(request.operation, "writer ticket sequence is exhausted");
  }
  connection.db.prepare(`INSERT INTO coordination_tickets(
    ticket_id,sequence,host,pid,deadline,enqueued_at) VALUES (?,?,?,?,?,?)`)
    .run(
      request.ticketId,
      state.nextWriterSequence,
      request.host,
      request.pid,
      request.deadline,
      request.enqueuedAt,
    );
  const advanced = connection.db.prepare(`UPDATE coordination_state
    SET next_writer_sequence=next_writer_sequence+1,revision=revision+1
    WHERE singleton=1 AND next_writer_sequence=?`).run(state.nextWriterSequence);
  if (Number(advanced.changes) !== 1) invalid(request.operation, "writer sequence changed");
  return { state: "queued", sequence: state.nextWriterSequence };
}

function runTryAdmit(
  connection: RecordDatabase,
  request: Extract<AdmissionRequest, { readonly operation: "try-admit" }>,
): boolean {
  recover(connection, request.now);
  const state = coordinationState(connection);
  if (state.writer !== undefined) {
    return sameWriter(state.writer, request);
  }
  if (state.barrier !== undefined) return false;
  const head = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,deadline,enqueued_at
    FROM coordination_tickets ORDER BY sequence LIMIT 1`).get() as
      | Record<string, unknown>
      | undefined);
  if (head === undefined || head.ticketId !== request.ticketId) return false;
  if (head.sequence !== request.sequence || head.host !== request.host || head.pid !== request.pid ||
    head.deadline !== request.deadline) {
    invalid(request.operation, "writer ticket identity changed before admission");
  }
  const removed = connection.db.prepare("DELETE FROM coordination_tickets WHERE ticket_id=? AND sequence=?")
    .run(request.ticketId, request.sequence);
  if (Number(removed.changes) !== 1) invalid(request.operation, "writer ticket changed before admission");
  const admitted = connection.db.prepare(`UPDATE coordination_state SET
    writer_ticket_id=?,writer_sequence=?,writer_host=?,writer_pid=?,writer_deadline=?,
    writer_enqueued_at=?,writer_nonce=?,writer_admitted_at=?,writer_lease_expires_at=?,
    revision=revision+1 WHERE singleton=1 AND writer_ticket_id IS NULL AND barrier_id IS NULL`)
    .run(
      request.ticketId,
      request.sequence,
      request.host,
      request.pid,
      request.deadline,
      head.enqueuedAt,
      request.ticketId,
      request.now,
      request.deadline,
    );
  if (Number(admitted.changes) !== 1) invalid(request.operation, "writer admission state changed");
  return true;
}

function runCancelWriter(
  connection: RecordDatabase,
  request: Extract<AdmissionRequest, { readonly operation: "cancel-writer" }>,
): void {
  recover(connection, request.now);
  const ticket = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,deadline,enqueued_at
    FROM coordination_tickets WHERE ticket_id=?`).get(request.ticketId) as
      | Record<string, unknown>
      | undefined);
  if (ticket !== undefined) {
    if (ticket.host !== request.host || ticket.pid !== request.pid) {
      invalid(request.operation, "writer cancellation identity does not match its ticket");
    }
    connection.db.prepare("DELETE FROM coordination_tickets WHERE ticket_id=? AND sequence=?")
      .run(request.ticketId, ticket.sequence);
  }
  const writer = coordinationState(connection).writer;
  if (writer !== undefined && writer.ticketId === request.ticketId) {
    if (writer.host !== request.host || writer.pid !== request.pid || writer.nonce !== request.ticketId) {
      invalid(request.operation, "writer cancellation identity does not match its owner");
    }
    clearWriter(connection, writer);
  }
}

function runReleaseWriter(
  connection: RecordDatabase,
  request: Extract<AdmissionRequest, { readonly operation: "release-writer" }>,
): void {
  recover(connection, request.now);
  const writer = coordinationState(connection).writer;
  if (writer === undefined) return;
  if (!sameWriter(writer, request)) {
    invalid(request.operation, "writer release identity does not match its owner");
  }
  clearWriter(connection, writer);
}

function runRequestBarrier(
  connection: RecordDatabase,
  request: Extract<AdmissionRequest, { readonly operation: "request-barrier" }>,
): boolean {
  recover(connection, request.requestedAt);
  const state = coordinationState(connection);
  if (state.barrier !== undefined) return sameBarrier(state.barrier, request);
  const established = connection.db.prepare(`UPDATE coordination_state SET
    barrier_id=?,barrier_nonce=?,barrier_host=?,barrier_pid=?,barrier_deadline=?,
    barrier_requested_at=?,barrier_lease_expires_at=?,barrier_status='requested',
    barrier_active_at=NULL,revision=revision+1 WHERE singleton=1 AND barrier_id IS NULL`)
    .run(
      request.barrierId,
      request.nonce,
      request.host,
      request.pid,
      request.deadline,
      request.requestedAt,
      request.deadline,
    );
  if (Number(established.changes) !== 1) invalid(request.operation, "write freeze changed");
  return true;
}

function runTryActivateBarrier(
  connection: RecordDatabase,
  request: Extract<AdmissionRequest, { readonly operation: "try-activate-barrier" }>,
): boolean {
  recover(connection, request.now);
  const state = coordinationState(connection);
  if (state.barrier === undefined) return false;
  if (!sameBarrier(state.barrier, request)) {
    invalid(request.operation, "write freeze identity changed before activation");
  }
  if (state.writer !== undefined) return false;
  if (state.barrier.status === "active") return true;
  const activated = connection.db.prepare(`UPDATE coordination_state SET
    barrier_status='active',barrier_active_at=?,revision=revision+1
    WHERE singleton=1 AND barrier_id=? AND barrier_nonce=? AND barrier_status='requested'
      AND writer_ticket_id IS NULL`)
    .run(request.now, request.barrierId, request.nonce);
  if (Number(activated.changes) !== 1) invalid(request.operation, "write freeze changed before activation");
  return true;
}

function runCancelBarrier(
  connection: RecordDatabase,
  request: Extract<AdmissionRequest, { readonly operation: "cancel-barrier" }>,
): void {
  recover(connection, request.now);
  const barrier = coordinationState(connection).barrier;
  if (barrier === undefined) return;
  if (barrier.barrierId !== request.barrierId) return;
  if (!sameBarrier(barrier, request)) {
    invalid(request.operation, "write freeze cancellation identity does not match its owner");
  }
  clearBarrier(connection, barrier);
}

function run(request: Exclude<AdmissionRequest, { readonly operation: "close" }>): unknown {
  const connection = connectionFor(request.path);
  return withImmediateTransaction(connection, request.deadline, request.operation, () => {
    switch (request.operation) {
      case "enqueue":
        return runEnqueue(connection, request);
      case "try-admit":
        return runTryAdmit(connection, request);
      case "cancel-writer":
        return runCancelWriter(connection, request);
      case "release-writer":
        return runReleaseWriter(connection, request);
      case "request-barrier":
        return runRequestBarrier(connection, request);
      case "try-activate-barrier":
        return runTryActivateBarrier(connection, request);
      case "cancel-barrier":
        return runCancelBarrier(connection, request);
    }
  });
}

function errorCode(cause: Error): string {
  const code = Reflect.get(cause, "code");
  return typeof code === "string" ? code : "record-coordination-state-invalid";
}

const port = parentPort;
if (!isMainThread && port !== null) {
  let closing = false;
  port.on("message", (value: unknown) => {
    if (closing) return;
    const id = isObject(value) && isPositiveInteger(value.id) ? value.id : undefined;
    if (id === undefined) return;
    if (!isAdmissionRequest(value)) {
      port.postMessage({
        id,
        state: "failure",
        error: {
          code: "record-coordination-state-invalid",
          message: "coordination worker received an invalid request",
        },
      } satisfies AdmissionResponse);
      return;
    }
    try {
      if (value.operation === "close") {
        closing = true;
        closeConnections();
        port.postMessage({ id, state: "success", result: undefined } satisfies AdmissionResponse);
        port.close();
        return;
      }
      port.postMessage({
        id,
        state: "success",
        result: run(value),
      } satisfies AdmissionResponse);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      port.postMessage({
        id,
        state: "failure",
        error: { code: errorCode(error), message: error.message },
      } satisfies AdmissionResponse);
    }
  });
}

process.on("exit", closeConnections);
