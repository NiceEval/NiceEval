import { Schema } from "effect";
import { recordStatement, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import {
  appendSharedStateGeneration,
  retireTeardownObligation,
  type SharedStateGenerationAppend,
  type TeardownObligationRow,
} from "./registry-repository.ts";

const OwnerEvidence = Schema.Struct({
  experimentId: Schema.NonEmptyString,
  pid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  host: Schema.NonEmptyString,
  processIdentity: Schema.NonEmptyString,
});
const RecoveryActor = Schema.Struct({
  pid: OwnerEvidence.fields.pid,
  host: OwnerEvidence.fields.host,
  processIdentity: OwnerEvidence.fields.processIdentity,
  startedAt: Schema.NonEmptyString,
});
const SetRow = Schema.Struct({
  id: Schema.NonEmptyString,
  invocationId: Schema.NonEmptyString,
  experimentId: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  ownerToken: Schema.NonEmptyString,
  owner: Schema.fromJsonString(OwnerEvidence),
  generation: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  phase: Schema.Literals(["active", "recovering", "free"]),
  recoveryId: Schema.NullOr(Schema.NonEmptyString),
  recoveryActor: Schema.NullOr(Schema.fromJsonString(RecoveryActor)),
  afterRegistrationId: Schema.NullOr(Schema.NonEmptyString),
  afterStatus: Schema.Literals(["not-required", "pending", "running", "completed"]),
});
const Members = Schema.NonEmptyArray(
  Schema.Struct({
    key: Schema.NonEmptyString,
    acquiredGeneration: SetRow.fields.generation,
    currentGeneration: SetRow.fields.generation,
  }),
);
const decodeSet = Schema.decodeUnknownSync(SetRow, { onExcessProperty: "error" });
const decodeMembers = Schema.decodeUnknownSync(Members);
export type StateLeaseOwner = typeof OwnerEvidence.Type;
export type StateLeaseRecoveryActor = typeof RecoveryActor.Type;
export type StateLeaseSet = typeof SetRow.Type & { readonly members: typeof Members.Type };
export type StateLeaseAuthority = Pick<StateLeaseSet, "id" | "generation" | "ownerToken" | "recoveryId">;
type Append = SharedStateGenerationAppend;

export type StateLeaseSetTransition =
  | {
      readonly _tag: "lease-set-acquire";
      readonly id: string;
      readonly invocationId: string;
      readonly runId: string;
      readonly ownerToken: string;
      readonly owner: StateLeaseOwner;
      readonly entries: readonly Append[];
    }
  | {
      readonly _tag: "lease-set-fence";
      readonly expected: StateLeaseAuthority;
      readonly expectedAfterStatus: StateLeaseSet["afterStatus"];
      readonly recoveryId: string;
      readonly actor: StateLeaseRecoveryActor;
      readonly entries: readonly Append[];
    }
  | {
      readonly _tag: "lease-set-release";
      readonly expected: StateLeaseAuthority;
      readonly entries: readonly Append[];
      readonly retirement?: TeardownObligationRow | undefined;
    };

export type StateLeaseRegistryCommand =
  | StateLeaseSetTransition
  | { readonly _tag: "lease-set-get"; readonly id: string }
  | { readonly _tag: "lease-set-pending"; readonly experimentId: string }
  | { readonly _tag: "lease-set-start-after"; readonly expected: StateLeaseAuthority }
  | {
      readonly _tag: "lease-set-finish-after";
      readonly expected: StateLeaseAuthority;
      readonly retirement: TeardownObligationRow;
    };

function invalid(message: string): never {
  throw sqliteError("record-command-conflict", "state-lease-set", message);
}

export function readStateLeaseSet(connection: RecordDatabase, id: string): StateLeaseSet | undefined {
  const row = recordStatement(
    connection,
    `SELECT id, invocation_id AS invocationId, experiment_id AS experimentId,
    run_id AS runId, owner_token AS ownerToken, owner_evidence_json AS owner, generation, phase,
    recovery_id AS recoveryId, recovery_actor_json AS recoveryActor, after_registration_id AS afterRegistrationId,
    after_status AS afterStatus FROM state_lease_set WHERE id=?`,
  ).get(id);
  if (row === undefined) return undefined;
  // The SQLite driver reads integers as bigint.
  const set = decodeSet({ ...row, generation: Number(row.generation) });
  const members = decodeMembers(
    recordStatement(
      connection,
      `SELECT key,
    acquired_generation AS acquiredGeneration, current_generation AS currentGeneration
    FROM state_lease_member WHERE set_id=? ORDER BY key`,
    )
      .all(id)
      .map((member) => ({
        key: member.key,
        acquiredGeneration: Number(member.acquiredGeneration),
        currentGeneration: Number(member.currentGeneration),
      })),
  );
  if (
    set.owner.experimentId !== set.experimentId ||
    members.some((member) => member.currentGeneration - member.acquiredGeneration !== set.generation - 1)
  )
    invalid("Lease set owner or member generations disagree with their acquisition");
  return { ...set, members };
}

function head(connection: RecordDatabase, key: string) {
  return recordStatement(
    connection,
    `SELECT generation, state_kind, lease_set_id, owner_token
    FROM ne19_shared_state_generations WHERE state_key=? ORDER BY generation DESC LIMIT 1`,
  ).get(key);
}

export function exactStateLeaseSet(connection: RecordDatabase, expected: StateLeaseAuthority) {
  const set = readStateLeaseSet(connection, expected.id);
  if (
    set?.generation !== expected.generation ||
    set.ownerToken !== expected.ownerToken ||
    set.recoveryId !== expected.recoveryId ||
    set.phase === "free"
  )
    return undefined;
  for (const member of set.members) {
    const current = head(connection, member.key);
    if (
      Number(current?.generation) !== member.currentGeneration ||
      current?.lease_set_id !== set.id ||
      current.owner_token !== set.ownerToken ||
      current.state_kind !== set.phase
    ) {
      invalid("Lease set member does not match the current key generation");
    }
  }
  return set;
}

function append(connection: RecordDatabase, entries: readonly Append[]) {
  for (const entry of entries) {
    if (!appendSharedStateGeneration({ connection, ...entry })) invalid("Lease set head changed");
  }
}

function validateEntries(
  entries: readonly Append[],
  id: string,
  token: string,
  owner: StateLeaseOwner,
  kind: Append["kind"],
) {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  if (
    entries.length === 0 ||
    byKey.size !== entries.length ||
    entries.some(
      (entry) =>
        entry.leaseSetId !== id ||
        entry.ownerToken !== token ||
        entry.kind !== kind ||
        entry.ownerPid !== owner.pid ||
        entry.ownerHost !== owner.host ||
        entry.ownerProcessIdentity !== owner.processIdentity ||
        entry.expectedGeneration !== entry.parentGeneration ||
        entry.generation !== entry.parentGeneration + 1 ||
        !Number.isSafeInteger(entry.generation),
    )
  )
    invalid("Invalid lease set key generations");
  return byKey;
}

function runBelongsToSet(
  connection: RecordDatabase,
  set: Pick<StateLeaseSet, "runId" | "invocationId" | "experimentId">,
) {
  return recordStatement(
    connection,
    `SELECT r.terminal_state
    FROM ne19_run_resources r JOIN ne19_invocation_session_experiments e ON e.run_id=r.run_id
    WHERE r.run_id=? AND r.invocation_id=? AND r.experiment_id=?
      AND e.invocation_id=r.invocation_id AND e.experiment_id=r.experiment_id
      AND NOT EXISTS (SELECT 1 FROM ne19_run_deletion_tombstones d WHERE d.run_id=r.run_id)`,
  ).get(set.runId, set.invocationId, set.experimentId);
}

function requireClosedRun(connection: RecordDatabase, set: StateLeaseSet) {
  if (typeof runBelongsToSet(connection, set)?.terminal_state !== "string") {
    invalid("The exact Run must be closed before completing lease set recovery");
  }
}

/** Called only inside the storage worker's immediate registry transaction. */
export function transitionStateLeaseSet(connection: RecordDatabase, command: StateLeaseSetTransition): boolean {
  if (command._tag === "lease-set-acquire") {
    const { id, invocationId, runId, ownerToken, owner, entries } = command;
    validateEntries(entries, id, ownerToken, owner, "active");
    if (
      runBelongsToSet(connection, { runId, invocationId, experimentId: owner.experimentId })?.terminal_state !== null ||
      !recordStatement(
        connection,
        `SELECT 1 FROM ne19_invocation_sessions s
          WHERE s.invocation_id=? AND s.state='active'`,
      ).get(invocationId) ||
      recordStatement(connection, "SELECT 1 FROM ne19_run_recoveries WHERE run_id=?").get(runId)
    ) {
      invalid("Lease set acquisition requires its exact active Invocation Run");
    }
    for (const entry of entries) {
      const current = head(connection, entry.key);
      if (
        Number(current?.generation ?? 0) !== entry.expectedGeneration ||
        (current !== undefined && current.state_kind !== "free")
      )
        return false;
    }
    recordStatement(
      connection,
      `INSERT INTO state_lease_set
      (id,invocation_id,experiment_id,run_id,owner_token,owner_evidence_json,generation,phase,after_status)
      VALUES (?,?,?,?,?,?,1,'active','not-required')`,
    ).run(id, invocationId, owner.experimentId, runId, ownerToken, JSON.stringify(owner));
    for (const entry of entries) {
      recordStatement(
        connection,
        `INSERT INTO state_lease_member
        (set_id,key,acquired_generation,current_generation) VALUES (?,?,?,?)`,
      ).run(id, entry.key, entry.generation, entry.generation);
    }
    append(connection, entries);
    return true;
  }

  const set = exactStateLeaseSet(connection, command.expected);
  if (set === undefined) return false;
  const fencing = command._tag === "lease-set-fence";
  if (fencing && command.expectedAfterStatus !== set.afterStatus) return false;
  const entries = validateEntries(command.entries, set.id, set.ownerToken, set.owner, fencing ? "recovering" : "free");
  if (
    entries.size !== set.members.length ||
    set.members.some((member) => entries.get(member.key)?.expectedGeneration !== member.currentGeneration)
  )
    invalid("Lease set transition requires every exact member generation");

  let afterStatus = set.afterStatus;
  if (command._tag === "lease-set-release") {
    if (set.phase === "recovering") requireClosedRun(connection, set);
    if (command.retirement !== undefined) {
      if (set.phase !== "active" || afterStatus !== "running" || command.retirement.id !== set.afterRegistrationId) {
        invalid("Lease set release cannot retire a different after registration");
      }
      retireTeardownObligation(connection, command.retirement);
      afterStatus = "completed";
    }
    if (afterStatus !== "not-required" && afterStatus !== "completed")
      invalid("Lease set still has an after obligation");
  }
  const phase = fencing ? "recovering" : "free";
  recordStatement(
    connection,
    `UPDATE state_lease_set SET phase=?,generation=generation+1,
    recovery_id=?,recovery_actor_json=?,after_status=? WHERE id=?`,
  ).run(
    phase,
    fencing ? command.recoveryId : null,
    fencing ? JSON.stringify(command.actor) : null,
    afterStatus,
    set.id,
  );
  for (const entry of command.entries) {
    recordStatement(connection, `UPDATE state_lease_member SET current_generation=? WHERE set_id=? AND key=?`).run(
      entry.generation,
      set.id,
      entry.key,
    );
  }
  append(connection, command.entries);
  return true;
}

export function registerStateLeaseAfter(
  connection: RecordDatabase,
  expected: StateLeaseAuthority,
  registrationId: string,
  owner: { readonly experimentId: string; readonly ownerPid: number; readonly ownerHost: string },
): void {
  const set = exactStateLeaseSet(connection, expected);
  if (
    set?.phase !== "active" ||
    set.afterStatus !== "not-required" ||
    registrationId !== set.id ||
    set.experimentId !== owner.experimentId ||
    set.owner.host !== owner.ownerHost ||
    set.owner.pid !== owner.ownerPid
  ) {
    invalid("Cannot register after outside its exact active lease set");
  }
  recordStatement(
    connection,
    `UPDATE state_lease_set SET after_registration_id=?,after_status='pending' WHERE id=?`,
  ).run(registrationId, set.id);
}

export function startStateLeaseAfter(connection: RecordDatabase, expected: StateLeaseAuthority): boolean {
  const set = exactStateLeaseSet(connection, expected);
  if (set === undefined || (set.afterStatus !== "pending" && set.afterStatus !== "running")) return false;
  if (set.phase === "recovering") requireClosedRun(connection, set);
  recordStatement(connection, "UPDATE state_lease_set SET after_status='running' WHERE id=?").run(set.id);
  return true;
}

export function finishStateLeaseAfter(
  connection: RecordDatabase,
  expected: StateLeaseAuthority,
  retirement: TeardownObligationRow,
): boolean {
  const set = exactStateLeaseSet(connection, expected);
  if (set?.phase !== "recovering" || set.afterStatus !== "running" || set.afterRegistrationId !== retirement.id)
    return false;
  requireClosedRun(connection, set);
  retireTeardownObligation(connection, retirement);
  recordStatement(connection, "UPDATE state_lease_set SET after_status='completed' WHERE id=?").run(set.id);
  return true;
}

export function listPendingStateLeaseSets(connection: RecordDatabase, experimentId: string): readonly StateLeaseSet[] {
  return recordStatement(
    connection,
    `SELECT id FROM state_lease_set WHERE experiment_id=?
    AND phase!='free' ORDER BY id`,
  )
    .all(experimentId)
    .map(({ id }) => {
      const set = readStateLeaseSet(connection, String(id));
      return set ?? invalid("Lease set disappeared within the registry transaction");
    });
}
