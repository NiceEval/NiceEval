import type { SQLOutputValue } from "node:sqlite";
import type { CaseCoordinationCommand } from "./worker-protocol.ts";
import { recordStatement, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import { withImmediateTransaction } from "./transaction.ts";

type Row = Readonly<Record<string, SQLOutputValue>>;

function conflict(operation: string, message: string): never {
  throw sqliteError("record-command-conflict", operation, message);
}

function text(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw sqliteError("record-database-invalid", "case-decode", `${field} is not text`);
  return value;
}

function integer(row: Row, field: string): number {
  const value = row[field];
  const decoded = typeof value === "bigint" ? Number(value) : value;
  if (typeof decoded !== "number" || !Number.isSafeInteger(decoded)) {
    throw sqliteError("record-database-invalid", "case-decode", `${field} is not an integer`);
  }
  return decoded;
}

function requireOpen(connection: RecordDatabase, operation: string): void {
  const row = recordStatement(connection, "SELECT barrier_state FROM record_metadata WHERE singleton=1").get() as Row | undefined;
  if (row === undefined || text(row, "barrier_state") !== "open") conflict(operation, "ProjectDatabase writer barrier is not open");
}

function ownerSql(): string {
  return "owner_id=? AND owner_generation=? AND owner_host=? AND owner_pid=? AND owner_boot_id=? AND owner_process_start=?";
}

function ownerArgs(owner: import("./coordination-repository.ts").FencedOwner): readonly (string | number)[] {
  return [owner.ownerId, owner.generation, owner.host, owner.pid, owner.bootId, owner.processStart];
}

function read(connection: RecordDatabase, caseId: string) {
  const row = recordStatement(connection, "SELECT * FROM case_locks WHERE case_id=?").get(caseId) as Row | undefined;
  return row === undefined ? undefined : Object.freeze({
    owner: Object.freeze({
      ownerId: text(row, "owner_id"), generation: integer(row, "owner_generation"),
      host: text(row, "owner_host"), pid: integer(row, "owner_pid"),
      bootId: text(row, "owner_boot_id"), processStart: text(row, "owner_process_start"),
    }),
    acquiredAt: text(row, "acquired_at"), heartbeatAt: text(row, "heartbeat_at"),
  });
}

export function executeCaseCommand(connection: RecordDatabase, command: CaseCoordinationCommand): object | undefined {
  if (command._tag === "case-read") return read(connection, command.caseId);
  return withImmediateTransaction(connection, command.deadlineEpochMs, command._tag, () => {
    requireOpen(connection, command._tag);
    switch (command._tag) {
      case "case-acquire": {
        if (read(connection, command.caseId) !== undefined) conflict(command._tag, `case ${command.caseId} is already owned`);
        const owner = command.owner;
        recordStatement(connection, `INSERT INTO case_locks(case_id,owner_id,owner_generation,owner_host,owner_pid,owner_boot_id,owner_process_start,acquired_at,heartbeat_at)
          VALUES (?,?,1,?,?,?,?,?,?)`).run(command.caseId, owner.ownerId, owner.host, owner.pid, owner.bootId, owner.processStart, command.at, command.at);
        return Object.freeze({ ...owner, generation: 1 });
      }
      case "case-heartbeat": {
        const changed = recordStatement(connection, `UPDATE case_locks SET heartbeat_at=? WHERE case_id=? AND ${ownerSql()}`)
          .run(command.at, command.caseId, ...ownerArgs(command.owner));
        if (Number(changed.changes) !== 1) conflict(command._tag, "case lock owner generation is fenced");
        return undefined;
      }
      case "case-release": {
        const changed = recordStatement(connection, `DELETE FROM case_locks WHERE case_id=? AND ${ownerSql()}`)
          .run(command.caseId, ...ownerArgs(command.owner));
        if (Number(changed.changes) !== 1) conflict(command._tag, "case lock owner generation is fenced");
        return undefined;
      }
      case "case-takeover": {
        const replacement = command.replacement;
        const changed = recordStatement(connection, `UPDATE case_locks SET owner_id=?,owner_generation=owner_generation+1,owner_host=?,owner_pid=?,
          owner_boot_id=?,owner_process_start=?,acquired_at=?,heartbeat_at=? WHERE case_id=? AND ${ownerSql()}`).run(
          replacement.ownerId, replacement.host, replacement.pid, replacement.bootId, replacement.processStart,
          command.at, command.at, command.caseId, ...ownerArgs(command.deadOwner),
        );
        if (Number(changed.changes) !== 1) conflict(command._tag, "exact dead case owner did not match");
        return Object.freeze({ ...replacement, generation: command.deadOwner.generation + 1 });
      }
    }
  });
}
