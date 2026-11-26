import type { SQLOutputValue } from "node:sqlite";
import { recordStatement, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
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
  readonly leaseSetId?: string;
}

function teardownRow(row: Row, owner: string): TeardownObligationRow {
  return {
    id: String(row.obligation_id),
    generation: Number(row.generation),
    payload: payload(row.payload, owner),
    ...(typeof row.lease_set_id === "string" ? { leaseSetId: row.lease_set_id } : {}),
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
    const row = recordStatement(
      connection,
      `INSERT INTO ne19_teardown_obligations(
      obligation_id,experiment_id,owner_pid,owner_host,generation,payload) VALUES(?,?,?,?,1,?)
      ON CONFLICT(obligation_id) DO UPDATE SET owner_host=excluded.owner_host,
        generation=ne19_teardown_obligations.generation+1,payload=excluded.payload
      RETURNING generation`,
    ).get(input.id, input.experimentId, input.ownerPid, input.ownerHost, input.payload) as Row;
    return Number(row.generation);
  });
}

export function getTeardownObligation(connection: RecordDatabase, id: string) {
  return withConnection(connection, (connection) => {
    const row = recordStatement(
      connection,
      `SELECT t.obligation_id,t.generation,t.payload,s.id AS lease_set_id
      FROM ne19_teardown_obligations t LEFT JOIN state_lease_set s ON s.after_registration_id=t.obligation_id
      WHERE t.obligation_id=?`,
    ).get(id) as Row | undefined;
    if (row === undefined) return undefined;
    return teardownRow(row, `teardown obligation ${id}`);
  });
}

export function listTeardownObligations(connection: RecordDatabase) {
  return withConnection(connection, (connection) =>
    (
      recordStatement(
        connection,
        `SELECT t.obligation_id,t.generation,t.payload,s.id AS lease_set_id
        FROM ne19_teardown_obligations t LEFT JOIN state_lease_set s ON s.after_registration_id=t.obligation_id
        ORDER BY t.experiment_id,t.owner_pid`,
      ).all() as Row[]
    ).map((row) => teardownRow(row, "teardown obligation")),
  );
}

export function claimTeardownObligation(connection: RecordDatabase, id: string) {
  return withConnection(connection, (connection) => {
    const row = recordStatement(
      connection,
      `SELECT generation FROM ne19_teardown_obligations
      WHERE obligation_id=?`,
    ).get(id) as Row | undefined;
    if (row === undefined) return false;
    const removed = recordStatement(
      connection,
      `DELETE FROM ne19_teardown_obligations
      WHERE obligation_id=? AND generation=?
        AND NOT EXISTS (SELECT 1 FROM state_lease_set WHERE after_registration_id=?)`,
    ).run(id, Number(row.generation), id);
    return Number(removed.changes) === 1;
  });
}

/** Called inside the same immediate transaction that appends the free generation. */
export function retireTeardownObligation(connection: RecordDatabase, expected: TeardownObligationRow): void {
  const removed = recordStatement(
    connection,
    `DELETE FROM ne19_teardown_obligations
      WHERE obligation_id=? AND generation=? AND payload=?`,
  ).run(expected.id, expected.generation, expected.payload);
  if (Number(removed.changes) === 1) return;
  throw sqliteError(
    "record-command-conflict",
    "teardown-claim",
    "The exact teardown registration changed before release",
  );
}

export interface SharedStateGenerationRow {
  readonly generation: number;
  readonly kind: "active" | "recovering" | "free";
  readonly payload: Uint8Array;
  readonly heartbeatAt: string;
  readonly leaseSetId: string;
}

function sharedStateRow(row: Row, key: string): SharedStateGenerationRow {
  const kind = String(row.state_kind);
  if (kind !== "active" && kind !== "recovering" && kind !== "free") {
    throw new Error(`sharedState ${JSON.stringify(key)} has an invalid generation kind`);
  }
  return {
    generation: Number(row.generation),
    kind,
    payload: payload(row.payload, "sharedState generation"),
    heartbeatAt: String(row.heartbeat_at),
    leaseSetId: String(row.lease_set_id),
  };
}

export function listSharedStateGenerations(connection: RecordDatabase, key: string) {
  return withConnection(connection, (connection) =>
    (
      recordStatement(
        connection,
        `SELECT generation,state_kind,payload,heartbeat_at,lease_set_id
    FROM ne19_shared_state_generations WHERE state_key=? ORDER BY generation`,
      ).all(key) as Row[]
    ).map((row) => sharedStateRow(row, key)),
  );
}

export interface SharedStateGenerationAppend {
  readonly key: string;
  readonly expectedGeneration: number;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly leaseSetId: string;
  readonly kind: "active" | "recovering" | "free";
  readonly ownerToken: string;
  readonly ownerPid: number;
  readonly ownerHost: string;
  readonly ownerProcessIdentity: string;
  readonly heartbeatAt: string;
  readonly payload: Uint8Array;
}

export function appendSharedStateGeneration(
  input: SharedStateGenerationAppend & { readonly connection: RecordDatabase },
) {
  return withConnection(input.connection, (connection) => {
    const head = recordStatement(
      connection,
      `SELECT coalesce(max(generation),0) AS generation
      FROM ne19_shared_state_generations WHERE state_key=?`,
    ).get(input.key) as Row;
    if (Number(head.generation) !== input.expectedGeneration) return false;
    const inserted = recordStatement(
      connection,
      `INSERT INTO ne19_shared_state_generations(
      state_key,generation,parent_generation,lease_set_id,state_kind,owner_token,owner_pid,owner_host,
      owner_process_identity,heartbeat_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.key,
      input.generation,
      input.parentGeneration,
      input.leaseSetId,
      input.kind,
      input.ownerToken,
      input.ownerPid,
      input.ownerHost,
      input.ownerProcessIdentity,
      input.heartbeatAt,
      input.payload,
    );
    if (Number(inserted.changes) !== 1) return false;
    return true;
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
    const changed = recordStatement(
      connection,
      `UPDATE ne19_shared_state_generations
      SET heartbeat_at=? WHERE state_key=? AND generation=? AND owner_token=?
      AND state_kind IN ('active','recovering')
      AND generation=(SELECT max(generation) FROM ne19_shared_state_generations WHERE state_key=?)`,
    ).run(input.heartbeatAt, input.key, input.generation, input.ownerToken, input.key);
    return Number(changed.changes) === 1;
  });
}
