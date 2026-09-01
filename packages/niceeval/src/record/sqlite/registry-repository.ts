import type { SQLOutputValue } from "node:sqlite";
import { recordStatement, type RecordDatabase } from "./database.ts";
type Row = Readonly<Record<string, SQLOutputValue>>;

function withConnection<A>(connection: RecordDatabase, body: (connection: RecordDatabase) => A): A {
  return body(connection);
}

function payload(value: SQLOutputValue, owner: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${owner} payload is not a SQLite BLOB`);
  return value;
}

export interface TeardownObligationRow {
  readonly id: string;
  readonly generation: number;
  readonly payload: Uint8Array;
}

function teardownRow(row: Row, owner: string): TeardownObligationRow {
  return {
    id: String(row.obligation_id),
    generation: Number(row.generation),
    payload: payload(row.payload, owner),
  };
}

export function putTeardownObligation(input: {
  readonly connection: RecordDatabase;
  readonly id: string;
  readonly experimentId: string;
  readonly ownerPid: number;
  readonly ownerHost: string;
  readonly payload: Uint8Array;
}) {
  return withConnection(input.connection, (connection) => {
    recordStatement(connection, `INSERT INTO teardown_obligations(
      obligation_id,experiment_id,owner_pid,owner_host,generation,payload) VALUES(?,?,?,?,1,?)
      ON CONFLICT(obligation_id) DO UPDATE SET owner_host=excluded.owner_host,
        generation=teardown_obligations.generation+1,payload=excluded.payload`)
      .run(input.id, input.experimentId, input.ownerPid, input.ownerHost, input.payload);
  });
}

export function getTeardownObligation(connection: RecordDatabase, id: string) {
  return withConnection(connection, (connection) => {
    const row = recordStatement(connection, `SELECT obligation_id,generation,payload
      FROM teardown_obligations WHERE obligation_id=?`).get(id) as Row | undefined;
    return row === undefined ? undefined : teardownRow(row, `teardown obligation ${id}`);
  });
}

export function listTeardownObligations(connection: RecordDatabase) {
  return withConnection(connection, (connection) => (recordStatement(connection, `SELECT obligation_id,generation,payload
    FROM teardown_obligations ORDER BY experiment_id,owner_pid`).all() as Row[])
    .map((row) => teardownRow(row, "teardown obligation")));
}

export function claimTeardownObligation(connection: RecordDatabase, id: string) {
  return withConnection(connection, (connection) => {
    const row = recordStatement(connection, `SELECT generation FROM teardown_obligations
      WHERE obligation_id=?`).get(id) as Row | undefined;
    if (row === undefined) return false;
    const removed = recordStatement(connection, `DELETE FROM teardown_obligations
      WHERE obligation_id=? AND generation=?`).run(id, Number(row.generation));
    return Number(removed.changes) === 1;
  });
}

export interface SharedStateGenerationRow {
  readonly generation: number;
  readonly kind: "active" | "recovering" | "free";
  readonly payload: Uint8Array;
  readonly heartbeatAt: string;
}

function sharedStateRow(row: Row, key: string): SharedStateGenerationRow {
  const kind = String(row.state_kind);
  if (kind !== "active" && kind !== "recovering" && kind !== "free") {
    throw new Error(`sharedState ${JSON.stringify(key)} has an invalid generation kind`);
  }
  return { generation: Number(row.generation), kind, payload: payload(row.payload, "sharedState generation"), heartbeatAt: String(row.heartbeat_at) };
}

export function listSharedStateGenerations(connection: RecordDatabase, key: string) {
  return withConnection(connection, (connection) => (recordStatement(connection, `SELECT generation,state_kind,payload,heartbeat_at
    FROM shared_state_generations WHERE state_key=? ORDER BY generation`).all(key) as Row[])
    .map((row) => sharedStateRow(row, key)));
}

export function appendSharedStateGeneration(input: {
  readonly connection: RecordDatabase;
  readonly key: string;
  readonly expectedGeneration: number;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly kind: "active" | "recovering" | "free";
  readonly ownerToken: string;
  readonly ownerPid: number;
  readonly ownerHost: string;
  readonly ownerProcessIdentity: string;
  readonly heartbeatAt: string;
  readonly payload: Uint8Array;
}) {
  return withConnection(input.connection, (connection) => {
    const head = recordStatement(connection, `SELECT coalesce(max(generation),0) AS generation
      FROM shared_state_generations WHERE state_key=?`).get(input.key) as Row;
    if (Number(head.generation) !== input.expectedGeneration) return false;
    const inserted = recordStatement(connection, `INSERT INTO shared_state_generations(
      state_key,generation,parent_generation,state_kind,owner_token,owner_pid,owner_host,
      owner_process_identity,heartbeat_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(input.key, input.generation, input.parentGeneration, input.kind, input.ownerToken,
        input.ownerPid, input.ownerHost, input.ownerProcessIdentity, input.heartbeatAt, input.payload);
    return Number(inserted.changes) === 1;
  });
}

export function updateSharedStateHeartbeat(input: {
  readonly connection: RecordDatabase;
  readonly key: string;
  readonly generation: number;
  readonly ownerToken: string;
  readonly heartbeatAt: string;
}) {
  return withConnection(input.connection, (connection) => {
    const changed = recordStatement(connection, `UPDATE shared_state_generations
      SET heartbeat_at=? WHERE state_key=? AND generation=? AND owner_token=?
      AND state_kind IN ('active','recovering')
      AND generation=(SELECT max(generation) FROM shared_state_generations WHERE state_key=?)`)
      .run(input.heartbeatAt, input.key, input.generation, input.ownerToken, input.key);
    return Number(changed.changes) === 1;
  });
}

export interface KeptSandboxRow {
  readonly id: string;
  readonly payload: Uint8Array;
}

export function putKeptSandbox(input: {
  readonly connection: RecordDatabase;
  readonly id: string;
  readonly provider: string;
  readonly sandboxId: string;
  readonly keptAt: string;
  readonly payload: Uint8Array;
}) {
  return withConnection(input.connection, (connection) => {
    recordStatement(connection, `INSERT INTO kept_sandboxes(entry_id,provider,sandbox_id,kept_at,payload)
      VALUES(?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET kept_at=excluded.kept_at,payload=excluded.payload`)
      .run(input.id, input.provider, input.sandboxId, input.keptAt, input.payload);
  });
}

export function getKeptSandbox(connection: RecordDatabase, id: string) {
  return withConnection(connection, (connection) => {
    const row = recordStatement(connection, "SELECT entry_id,payload FROM kept_sandboxes WHERE entry_id=?")
      .get(id) as Row | undefined;
    return row === undefined ? undefined : { id: String(row.entry_id), payload: payload(row.payload, `kept sandbox ${id}`) };
  });
}

export function listKeptSandboxes(connection: RecordDatabase) {
  return withConnection(connection, (connection) => (recordStatement(connection, `SELECT entry_id,payload
    FROM kept_sandboxes ORDER BY kept_at,entry_id`).all() as Row[]).map((row) => ({
    id: String(row.entry_id), payload: payload(row.payload, "kept sandbox"),
  })));
}

export function updateKeptSandbox(connection: RecordDatabase, id: string, value: Uint8Array) {
  return withConnection(connection, (connection) => Number(recordStatement(connection,
    "UPDATE kept_sandboxes SET payload=? WHERE entry_id=?").run(value, id).changes) === 1);
}

export function deleteKeptSandbox(connection: RecordDatabase, id: string) {
  return withConnection(connection, (connection) => {
    recordStatement(connection, "DELETE FROM kept_sandboxes WHERE entry_id=?").run(id);
  });
}

export interface KeptSandboxLeaseRow {
  readonly generation: number;
  readonly token: string;
  readonly holder: string;
  readonly operation: string;
  readonly acquiredAt: string;
  readonly ttlMs: number;
  readonly ownerPid: number;
  readonly ownerHost: string;
  readonly ownerProcessIdentity: string;
}

function keptLeaseRow(row: Row): KeptSandboxLeaseRow {
  return {
    generation: Number(row.generation), token: String(row.token), holder: String(row.holder),
    operation: String(row.operation), acquiredAt: String(row.acquired_at), ttlMs: Number(row.ttl_ms),
    ownerPid: Number(row.owner_pid), ownerHost: String(row.owner_host),
    ownerProcessIdentity: String(row.owner_process_identity),
  };
}

export function getKeptSandboxLease(connection: RecordDatabase, id: string) {
  return withConnection(connection, (connection) => {
    const row = recordStatement(connection, `SELECT * FROM kept_sandbox_operation_leases
      WHERE entry_id=?`).get(id) as Row | undefined;
    return row === undefined ? undefined : keptLeaseRow(row);
  });
}

export function acquireKeptSandboxLease(input: {
  readonly connection: RecordDatabase;
  readonly id: string;
  readonly token: string;
  readonly holder: string;
  readonly operation: string;
  readonly acquiredAt: string;
  readonly ttlMs: number;
  readonly ownerPid: number;
  readonly ownerHost: string;
  readonly ownerProcessIdentity: string;
}) {
  return withConnection(input.connection, (connection) => {
    const current = recordStatement(connection, `SELECT * FROM kept_sandbox_operation_leases
      WHERE entry_id=?`).get(input.id) as Row | undefined;
    if (current !== undefined) return { acquired: false as const, lease: keptLeaseRow(current) };
    const advanced = recordStatement(connection, `UPDATE kept_sandboxes SET operation_generation=operation_generation+1
      WHERE entry_id=?`).run(input.id);
    if (Number(advanced.changes) !== 1) throw new Error(`kept sandbox ${input.id} is missing`);
    const row = recordStatement(connection, "SELECT operation_generation FROM kept_sandboxes WHERE entry_id=?")
      .get(input.id) as Row;
    const generation = Number(row.operation_generation);
    recordStatement(connection, `INSERT INTO kept_sandbox_operation_leases(entry_id,generation,token,holder,
      owner_pid,owner_host,owner_process_identity,operation,acquired_at,ttl_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(input.id, generation, input.token, input.holder, input.ownerPid, input.ownerHost,
        input.ownerProcessIdentity, input.operation, input.acquiredAt, input.ttlMs);
    return { acquired: true as const, generation };
  });
}

export function releaseKeptSandboxLease(input: {
  readonly connection: RecordDatabase;
  readonly id: string;
  readonly generation: number;
  readonly token: string;
  readonly ownerPid: number;
  readonly ownerHost: string;
  readonly ownerProcessIdentity: string;
}) {
  return withConnection(input.connection, (connection) => Number(recordStatement(connection,
    `DELETE FROM kept_sandbox_operation_leases WHERE entry_id=? AND generation=? AND token=?
      AND owner_pid=? AND owner_host=? AND owner_process_identity=?`)
    .run(input.id, input.generation, input.token, input.ownerPid, input.ownerHost, input.ownerProcessIdentity).changes) === 1);
}
