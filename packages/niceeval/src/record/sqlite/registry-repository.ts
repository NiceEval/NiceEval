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
}

export type TeardownRetirement = TeardownObligationRow | { readonly id: string; readonly generation: null };

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
      `SELECT obligation_id,generation,payload
      FROM ne19_teardown_obligations WHERE obligation_id=?`,
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
        `SELECT obligation_id,generation,payload
    FROM ne19_teardown_obligations ORDER BY experiment_id,owner_pid`,
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
      WHERE obligation_id=? AND generation=?`,
    ).run(id, Number(row.generation));
    return Number(removed.changes) === 1;
  });
}

/** Called inside the same immediate transaction that appends the free generation. */
function retireTeardownObligation(connection: RecordDatabase, expected: TeardownRetirement): void {
  if (expected.generation === null) {
    if (getTeardownObligation(connection, expected.id) === undefined) return;
  } else {
    const removed = recordStatement(
      connection,
      `DELETE FROM ne19_teardown_obligations
        WHERE obligation_id=? AND generation=? AND payload=?`,
    ).run(expected.id, expected.generation, expected.payload);
    if (Number(removed.changes) === 1) return;
  }
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
  };
}

export function listSharedStateGenerations(connection: RecordDatabase, key: string) {
  return withConnection(connection, (connection) =>
    (
      recordStatement(
        connection,
        `SELECT generation,state_kind,payload,heartbeat_at
    FROM ne19_shared_state_generations WHERE state_key=? ORDER BY generation`,
      ).all(key) as Row[]
    ).map((row) => sharedStateRow(row, key)),
  );
}

export function appendSharedStateGeneration(input: {
  readonly retirement?: TeardownRetirement | undefined;
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
    const head = recordStatement(
      connection,
      `SELECT coalesce(max(generation),0) AS generation
      FROM ne19_shared_state_generations WHERE state_key=?`,
    ).get(input.key) as Row;
    if (Number(head.generation) !== input.expectedGeneration) return false;
    const inserted = recordStatement(
      connection,
      `INSERT INTO ne19_shared_state_generations(
      state_key,generation,parent_generation,state_kind,owner_token,owner_pid,owner_host,
      owner_process_identity,heartbeat_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.key,
      input.generation,
      input.parentGeneration,
      input.kind,
      input.ownerToken,
      input.ownerPid,
      input.ownerHost,
      input.ownerProcessIdentity,
      input.heartbeatAt,
      input.payload,
    );
    if (Number(inserted.changes) !== 1) return false;
    if (input.retirement !== undefined) {
      if (input.kind !== "free") throw new Error("Only a free generation can retire teardown");
      retireTeardownObligation(connection, input.retirement);
    }
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
