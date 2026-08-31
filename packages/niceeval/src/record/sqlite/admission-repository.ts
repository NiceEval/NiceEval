import { randomUUID } from "node:crypto";
import type { RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import { withImmediateTransaction } from "./transaction.ts";
import { exactProcessState } from "../../coordination/platform/node-process-identity.ts";
import type {
  AdmissionInput,
  EnqueueResult,
} from "../../coordination/platform/node-record-admission-protocol.ts";

const MAXIMUM_STALE_HEADS_PER_TRANSACTION = 16;

interface WriterOwner {
  readonly ticketId: string;
  readonly sequence: number;
  readonly host: string;
  readonly pid: number;
  readonly bootId: string;
  readonly processStart: string;
  readonly deadline: number;
  readonly nonce: string;
  readonly leaseExpiresAt: number;
}

interface BarrierOwner {
  readonly barrierId: string;
  readonly nonce: string;
  readonly host: string;
  readonly pid: number;
  readonly bootId: string;
  readonly processStart: string;
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
  readonly bootId: string;
  readonly processStart: string;
  readonly deadline: number;
  readonly enqueuedAt: number;
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

function isExactlyDead(owner: { readonly host: string; readonly pid: number; readonly bootId: string; readonly processStart: string }): boolean {
  return exactProcessState({ ownerId: "admission-owner", ...owner }) === "dead";
}

function waitingTicket(row: Record<string, unknown> | undefined): WaitingTicket | undefined {
  if (row === undefined) return undefined;
  return {
    ticketId: text(row.ticket_id, "coordination_tickets.ticket_id"),
    sequence: positiveInteger(row.sequence, "coordination_tickets.sequence"),
    host: text(row.host, "coordination_tickets.host"),
    pid: positiveInteger(row.pid, "coordination_tickets.pid"),
    bootId: text(row.boot_id, "coordination_tickets.boot_id"),
    processStart: text(row.process_start, "coordination_tickets.process_start"),
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
        bootId: text(row.writer_boot_id, "coordination_state.writer_boot_id"),
        processStart: text(row.writer_process_start, "coordination_state.writer_process_start"),
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
      bootId: text(row.barrier_boot_id, "coordination_state.barrier_boot_id"),
      processStart: text(row.barrier_process_start, "coordination_state.barrier_process_start"),
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
    writer_boot_id=NULL,writer_process_start=NULL,
    writer_deadline=NULL,writer_enqueued_at=NULL,writer_nonce=NULL,
    writer_admitted_at=NULL,writer_lease_expires_at=NULL,revision=revision+1
    WHERE singleton=1 AND writer_ticket_id=? AND writer_sequence=? AND writer_nonce=?`)
    .run(owner.ticketId, owner.sequence, owner.nonce);
  if (Number(result.changes) !== 1) invalid("coordination", "writer owner changed while clearing");
}

function clearBarrier(connection: RecordDatabase, owner: BarrierOwner): void {
  const result = connection.db.prepare(`UPDATE coordination_state SET
    barrier_id=NULL,barrier_nonce=NULL,barrier_host=NULL,barrier_pid=NULL,
    barrier_boot_id=NULL,barrier_process_start=NULL,
    barrier_deadline=NULL,barrier_requested_at=NULL,barrier_lease_expires_at=NULL,
    barrier_status=NULL,barrier_active_at=NULL,revision=revision+1
    WHERE singleton=1 AND barrier_id=? AND barrier_nonce=?`)
    .run(owner.barrierId, owner.nonce);
  if (Number(result.changes) !== 1) invalid("coordination", "write freeze changed while clearing");
}

function recover(connection: RecordDatabase, _now: number): void {
  for (let count = 0; count < MAXIMUM_STALE_HEADS_PER_TRANSACTION; count += 1) {
    const head = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,boot_id,process_start,deadline,enqueued_at
      FROM coordination_tickets ORDER BY sequence LIMIT 1`).get() as
        | Record<string, unknown>
        | undefined);
    if (head === undefined || !isExactlyDead(head)) break;
    connection.db.prepare("DELETE FROM coordination_tickets WHERE ticket_id=? AND sequence=?")
      .run(head.ticketId, head.sequence);
  }

  const state = coordinationState(connection);
  if (state.writer !== undefined && isExactlyDead(state.writer)) {
    clearWriter(connection, state.writer);
  }
  if (state.barrier !== undefined && isExactlyDead(state.barrier)) {
    clearBarrier(connection, state.barrier);
  }
}

function sameWriter(owner: WriterOwner, request: {
  readonly ticketId: string;
  readonly sequence: number;
  readonly host: string;
  readonly pid: number;
  readonly bootId: string;
  readonly processStart: string;
}): boolean {
  return owner.ticketId === request.ticketId && owner.sequence === request.sequence &&
    owner.host === request.host && owner.pid === request.pid && owner.bootId === request.bootId &&
    owner.processStart === request.processStart && owner.nonce === request.ticketId;
}

function sameBarrier(owner: BarrierOwner, request: {
  readonly barrierId: string;
  readonly nonce: string;
  readonly host: string;
  readonly pid: number;
  readonly bootId: string;
  readonly processStart: string;
}): boolean {
  return owner.barrierId === request.barrierId && owner.nonce === request.nonce &&
    owner.host === request.host && owner.pid === request.pid && owner.bootId === request.bootId &&
    owner.processStart === request.processStart;
}

function runEnqueue(
  connection: RecordDatabase,
  request: Extract<AdmissionInput, { readonly operation: "enqueue" }>,
): EnqueueResult {
  const metadata = connection.db.prepare("SELECT barrier_state FROM record_metadata WHERE singleton=1").get() as
    | Record<string, unknown>
    | undefined;
  if (metadata === undefined) invalid(request.operation, "ProjectDatabase barrier is missing");
  if (metadata.barrier_state === "draining") return { state: "blocked-by-barrier" };
  if (metadata.barrier_state === "portable") {
    const generation = randomUUID();
    connection.db.prepare(`UPDATE record_metadata SET barrier_state='open',storage_generation=?,portable_generation=NULL,
      portable_revision=NULL,portable_gate_id=NULL WHERE singleton=1 AND barrier_state='portable'`).run(generation);
    connection.db.prepare("UPDATE coordination_state SET operational_generation=?,revision=revision+1 WHERE singleton=1")
      .run(generation);
  } else if (metadata.barrier_state !== "open") {
    invalid(request.operation, "ProjectDatabase barrier is invalid");
  }
  recover(connection, request.enqueuedAt);
  const existing = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,boot_id,process_start,deadline,enqueued_at
    FROM coordination_tickets WHERE ticket_id=?`).get(request.ticketId) as
      | Record<string, unknown>
      | undefined);
  if (existing !== undefined) {
    if (existing.host !== request.host || existing.pid !== request.pid ||
      existing.bootId !== request.bootId || existing.processStart !== request.processStart ||
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
    ticket_id,sequence,host,pid,boot_id,process_start,deadline,enqueued_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(
      request.ticketId,
      state.nextWriterSequence,
      request.host,
      request.pid,
      request.bootId,
      request.processStart,
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
  request: Extract<AdmissionInput, { readonly operation: "try-admit" }>,
): boolean {
  recover(connection, request.now);
  const state = coordinationState(connection);
  if (state.writer !== undefined) {
    return sameWriter(state.writer, request);
  }
  if (state.barrier !== undefined) return false;
  const head = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,boot_id,process_start,deadline,enqueued_at
    FROM coordination_tickets ORDER BY sequence LIMIT 1`).get() as
      | Record<string, unknown>
      | undefined);
  if (head === undefined || head.ticketId !== request.ticketId) return false;
  if (head.sequence !== request.sequence || head.host !== request.host || head.pid !== request.pid ||
    head.bootId !== request.bootId || head.processStart !== request.processStart ||
    head.deadline !== request.deadline) {
    invalid(request.operation, "writer ticket identity changed before admission");
  }
  const removed = connection.db.prepare("DELETE FROM coordination_tickets WHERE ticket_id=? AND sequence=?")
    .run(request.ticketId, request.sequence);
  if (Number(removed.changes) !== 1) invalid(request.operation, "writer ticket changed before admission");
  const admitted = connection.db.prepare(`UPDATE coordination_state SET
    writer_ticket_id=?,writer_sequence=?,writer_host=?,writer_pid=?,writer_boot_id=?,writer_process_start=?,writer_deadline=?,
    writer_enqueued_at=?,writer_nonce=?,writer_admitted_at=?,writer_lease_expires_at=?,
    revision=revision+1 WHERE singleton=1 AND writer_ticket_id IS NULL AND barrier_id IS NULL`)
    .run(
      request.ticketId,
      request.sequence,
      request.host,
      request.pid,
      request.bootId,
      request.processStart,
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
  request: Extract<AdmissionInput, { readonly operation: "cancel-writer" }>,
): void {
  recover(connection, request.now);
  const ticket = waitingTicket(connection.db.prepare(`SELECT ticket_id,sequence,host,pid,boot_id,process_start,deadline,enqueued_at
    FROM coordination_tickets WHERE ticket_id=?`).get(request.ticketId) as
      | Record<string, unknown>
      | undefined);
  if (ticket !== undefined) {
    if (ticket.host !== request.host || ticket.pid !== request.pid ||
      ticket.bootId !== request.bootId || ticket.processStart !== request.processStart) {
      invalid(request.operation, "writer cancellation identity does not match its ticket");
    }
    connection.db.prepare("DELETE FROM coordination_tickets WHERE ticket_id=? AND sequence=?")
      .run(request.ticketId, ticket.sequence);
  }
  const writer = coordinationState(connection).writer;
  if (writer !== undefined && writer.ticketId === request.ticketId) {
    if (!sameWriter(writer, { ...request, sequence: writer.sequence })) {
      invalid(request.operation, "writer cancellation identity does not match its owner");
    }
    clearWriter(connection, writer);
  }
}

function runReleaseWriter(
  connection: RecordDatabase,
  request: Extract<AdmissionInput, { readonly operation: "release-writer" }>,
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
  request: Extract<AdmissionInput, { readonly operation: "request-barrier" }>,
): boolean {
  recover(connection, request.requestedAt);
  const state = coordinationState(connection);
  if (state.barrier !== undefined) return sameBarrier(state.barrier, request);
  const established = connection.db.prepare(`UPDATE coordination_state SET
    barrier_id=?,barrier_nonce=?,barrier_host=?,barrier_pid=?,barrier_boot_id=?,barrier_process_start=?,barrier_deadline=?,
    barrier_requested_at=?,barrier_lease_expires_at=?,barrier_status='requested',
    barrier_active_at=NULL,revision=revision+1 WHERE singleton=1 AND barrier_id IS NULL`)
    .run(
      request.barrierId,
      request.nonce,
      request.host,
      request.pid,
      request.bootId,
      request.processStart,
      request.deadline,
      request.requestedAt,
      request.deadline,
    );
  if (Number(established.changes) !== 1) invalid(request.operation, "write freeze changed");
  return true;
}

function runTryActivateBarrier(
  connection: RecordDatabase,
  request: Extract<AdmissionInput, { readonly operation: "try-activate-barrier" }>,
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
  request: Extract<AdmissionInput, { readonly operation: "cancel-barrier" }>,
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

/** Executes admission SQL on the canonical storage worker's owned connection. */
export function executeAdmissionCommand(
  connection: RecordDatabase,
  request: AdmissionInput,
): unknown {
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
