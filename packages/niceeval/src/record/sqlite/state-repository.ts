import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";
import {
  AttemptStateSchema,
  compareStateLineage,
  StateCheckpointSchema,
  StateExecutionSchema,
  StateIdentitySchema,
  StateLineageSchema,
  StateManifestSchema,
  type AttemptState,
  type AttemptStateResult,
  type RunSandboxState,
  type StateCheckpoint,
  type StateExecution,
  type StateFailureReason,
  type StateLineage,
  type StateManifest,
  type StateOrigin,
  type StateSave,
} from "../../state/protocol.ts";
import { stateLeaseKey, stateLineageId } from "../../state/identity.ts";
import { recordStatement, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import { exactStateLeaseSet, type StateLeaseAuthority } from "./state-lease-repository.ts";

const strict = { onExcessProperty: "error" } as const;
const decodeCheckpoint = Schema.decodeUnknownSync(StateCheckpointSchema, strict);
const decodeExecution = Schema.decodeUnknownSync(StateExecutionSchema, strict);
const decodeLineage = Schema.decodeUnknownSync(StateLineageSchema, strict);
const decodeManifest = Schema.decodeUnknownSync(StateManifestSchema, strict);
const decodeId = Schema.decodeUnknownSync(StateIdentitySchema);
const decodeAttemptState = Schema.decodeUnknownSync(AttemptStateSchema, strict);

const emptyDigest = `sha256:${createHash("sha256").digest("hex")}`;

export const stateChunkLimit = 1024 * 1024;

interface Owner {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly leaseSet: StateLeaseAuthority;
}

export interface StateExecutionWriter extends Owner {
  readonly executionId: string;
}

export type StateCommand =
  | { readonly _tag: "state-start"; readonly owner: StateExecutionWriter; readonly lineages: readonly StateLineage[] }
  | {
      readonly _tag: "state-restore-result";
      readonly owner: StateExecutionWriter;
      readonly reason?: StateFailureReason | undefined;
    }
  | {
      readonly _tag: "state-save-failure";
      readonly owner: StateExecutionWriter;
      readonly result: Extract<StateSave, { readonly reason: StateFailureReason }>;
    }
  | {
      readonly _tag: "state-stage-start";
      readonly owner: StateExecutionWriter;
      readonly ordinal: number;
      readonly id: string;
      readonly manifest: StateManifest;
    }
  | {
      readonly _tag: "state-stage-chunk";
      readonly owner: StateExecutionWriter;
      readonly id: string;
      readonly ordinal: number;
      readonly bytes: Uint8Array;
    }
  | {
      readonly _tag: "state-stage-seal";
      readonly owner: StateExecutionWriter;
      readonly checkpoint: StateCheckpoint;
      readonly chunkCount: number;
    }
  | {
      readonly _tag: "state-commit";
      readonly owner: StateExecutionWriter;
      readonly checkpoints: readonly StateCheckpoint[];
    }
  | { readonly _tag: "state-origin-info"; readonly owner: StateExecutionWriter; readonly id: string }
  | {
      readonly _tag: "state-origin-chunk";
      readonly owner: StateExecutionWriter;
      readonly id: string;
      readonly ordinal: number;
    }
  | {
      readonly _tag: "state-stage-read";
      readonly owner: StateExecutionWriter;
      readonly id: string;
      readonly ordinal: number;
    }
  | { readonly _tag: "state-read-execution"; readonly executionId: string };

export interface StateCheckpointArchive {
  readonly checkpoint: StateCheckpoint;
  readonly manifest: StateManifest;
  readonly chunkCount: number;
}

export interface StateRunClock {
  readonly requireActiveWriter: (connection: RecordDatabase, runId: string, writer: string) => unknown;
  readonly nextRevision: (connection: RecordDatabase) => number;
}

export function isStateRead(command: StateCommand): boolean {
  switch (command._tag) {
    case "state-origin-info":
    case "state-origin-chunk":
    case "state-stage-read":
    case "state-read-execution":
      return true;
    default:
      return false;
  }
}

function invalid(detail: string): never {
  throw sqliteError("record-command-conflict", "sandbox-state", detail);
}

function integer(value: unknown): number {
  const number = Number(value);
  if (typeof value !== "bigint" || !Number.isSafeInteger(number) || number < 0) invalid("Invalid State row integer");
  return number;
}

function parseFact(payload: unknown): StateExecution {
  if (typeof payload !== "string") invalid("Invalid State fact payload");
  const fact = decodeExecution(JSON.parse(payload));
  if (
    fact.bindings.some(
      ({ lineage }, index) =>
        lineage.experimentId !== fact.experimentId ||
        lineage.evalGroupId !== fact.evalGroupId ||
        (index > 0 && compareStateLineage(fact.bindings[index - 1]!.lineage, lineage) >= 0),
    )
  ) {
    invalid("State bindings disagree with their execution identity or ordering");
  }
  if (
    fact.save.status === "saved" &&
    (fact.restore.status !== "ready" || fact.save.checkpoints.length !== fact.bindings.length)
  ) {
    invalid("Saved State fact does not cover its complete ready execution");
  }
  if (fact.save.status === "conflict" && fact.save.actual.length !== fact.bindings.length) {
    invalid("State conflict does not cover its complete execution");
  }
  return fact;
}

function latestFact(connection: RecordDatabase, executionId: string, revision = Number.MAX_SAFE_INTEGER) {
  const row = recordStatement(
    connection,
    `SELECT f.payload_json,e.run_id,e.experiment_id,e.eval_group_id,e.generation
    FROM state_execution_fact f JOIN state_execution e ON e.id=f.execution_id
    WHERE f.execution_id=? AND f.publication_sequence<=? ORDER BY f.publication_sequence DESC LIMIT 1`,
  ).get(executionId, revision);
  if (row === undefined) return undefined;
  const fact = parseFact(row.payload_json);
  if (
    fact.executionId !== executionId ||
    fact.runId !== row.run_id ||
    fact.experimentId !== row.experiment_id ||
    fact.evalGroupId !== row.eval_group_id ||
    fact.generation !== integer(row.generation)
  ) {
    invalid("State fact does not match the execution row");
  }
  return fact;
}

function appendFact(
  connection: RecordDatabase,
  fact: StateExecution,
  revision: number,
  writer: string,
): StateExecution {
  const payload = JSON.stringify(fact);
  parseFact(payload);
  recordStatement(connection, `INSERT INTO state_execution_fact VALUES (?,?,?,?)`).run(
    fact.executionId,
    revision,
    writer,
    payload,
  );
  return fact;
}

function readCheckpoint(connection: RecordDatabase, id: string, allowStaging = false): StateCheckpointArchive {
  const row = recordStatement(connection, "SELECT * FROM state_checkpoint WHERE id=? AND (ready=1 OR ?)").get(
    id,
    Number(allowStaging),
  );
  if (row === undefined) invalid("The exact State checkpoint is missing or incomplete");
  if (typeof row.manifest_json !== "string") invalid("Invalid State checkpoint manifest");
  const manifest = decodeManifest(JSON.parse(row.manifest_json));
  if (manifest.roots.some((root, index) => index > 0 && manifest.roots[index - 1]!.declared >= root.declared)) {
    invalid("State checkpoint roots are not sorted and unique");
  }
  return {
    checkpoint: decodeCheckpoint({ checkpointId: id, digest: row.digest, bytes: integer(row.bytes) }),
    manifest,
    chunkCount: integer(row.chunk_count),
  };
}

export function readStateOrigins(connection: RecordDatabase, lineages: readonly StateLineage[]) {
  return lineages.map((lineage) => {
    const row = recordStatement(connection, "SELECT head_id FROM state_lineage WHERE id=?").get(
      stateLineageId(lineage),
    );
    const origin: StateOrigin =
      typeof row?.head_id === "string"
        ? { kind: "checkpoint", checkpoint: readCheckpoint(connection, row.head_id).checkpoint }
        : { kind: "fresh" };
    return { lineage, origin };
  });
}

export function registerRunState(connection: RecordDatabase, runId: string): void {
  recordStatement(connection, "INSERT INTO state_run VALUES (?)").run(runId);
}

export function readRunSandboxState(connection: RecordDatabase, runId: string, revision: number): RunSandboxState {
  if (recordStatement(connection, "SELECT 1 FROM state_run WHERE run_id=?").get(runId) === undefined) {
    return { status: "unavailable" };
  }
  const executions = recordStatement(
    connection,
    `SELECT id FROM state_execution WHERE run_id=?
    ORDER BY eval_group_id, generation`,
  )
    .all(runId)
    .flatMap(({ id }) => {
      const fact = latestFact(connection, String(id), revision);
      return fact === undefined ? [] : [fact];
    });
  return { status: "known", executions };
}

export function writeAttemptState(
  connection: RecordDatabase,
  attemptId: string,
  input: { readonly runId: string; readonly writerGeneration: string },
  state: AttemptState,
): void {
  decodeAttemptState(state);
  const row = recordStatement(connection, "SELECT writer_generation FROM state_execution WHERE id=? AND run_id=?").get(
    state.executionId,
    input.runId,
  );
  const fact = latestFact(connection, state.executionId);
  if (row?.writer_generation !== input.writerGeneration || fact?.restore.status !== "ready") {
    invalid("Attempt State context lacks its ready execution");
  }
  recordStatement(connection, "INSERT INTO state_attempt VALUES (?,?,?)").run(
    attemptId,
    state.executionId,
    state.earlierAttempts,
  );
}

export function readAttemptSandboxState(
  connection: RecordDatabase,
  attemptId: string,
  originRunId: string,
): AttemptStateResult {
  if (recordStatement(connection, "SELECT 1 FROM state_run WHERE run_id=?").get(originRunId) === undefined) {
    return { status: "unavailable" };
  }
  const row = recordStatement(
    connection,
    "SELECT execution_id,earlier_attempts FROM state_attempt WHERE attempt_id=?",
  ).get(attemptId);
  return {
    status: "known",
    context:
      row === undefined
        ? null
        : decodeAttemptState({
            executionId: row.execution_id,
            earlierAttempts: integer(row.earlier_attempts),
          }),
  };
}

function authorize(connection: RecordDatabase, clock: StateRunClock, owner: Owner) {
  clock.requireActiveWriter(connection, owner.runId, owner.writerGeneration);
  const set = exactStateLeaseSet(connection, owner.leaseSet);
  if (set?.phase !== "active" || set.runId !== owner.runId) invalid("State lease set or Run writer lost authority");
  return set;
}

function authorizeExecution(connection: RecordDatabase, clock: StateRunClock, owner: StateExecutionWriter) {
  authorize(connection, clock, owner);
  const row = recordStatement(
    connection,
    "SELECT 1 FROM state_execution WHERE id=? AND run_id=? AND writer_generation=? AND lease_set_id=?",
  ).get(owner.executionId, owner.runId, owner.writerGeneration, owner.leaseSet.id);
  const fact = latestFact(connection, owner.executionId);
  if (row === undefined || fact === undefined) invalid("State execution writer changed");
  return fact;
}

function startExecution(
  connection: RecordDatabase,
  clock: StateRunClock,
  owner: StateExecutionWriter,
  input: readonly StateLineage[],
) {
  const set = authorize(connection, clock, owner);
  decodeId(owner.executionId);
  const lineages = input.map((lineage) => decodeLineage(lineage)).sort(compareStateLineage);
  const first = lineages[0];
  if (
    first === undefined ||
    lineages.some(
      (lineage, index) =>
        lineage.evalGroupId !== first.evalGroupId ||
        lineage.experimentId !== set.experimentId ||
        !set.members.some(({ key }) => key === stateLeaseKey(lineage)) ||
        (index > 0 && compareStateLineage(lineages[index - 1]!, lineage) === 0),
    )
  ) {
    invalid("State execution lineages are not covered by the exact Experiment lease set");
  }
  const existing = latestFact(connection, owner.executionId);
  if (existing !== undefined) {
    const exact = authorizeExecution(connection, clock, owner);
    if (JSON.stringify(exact.bindings.map(({ lineage }) => lineage)) !== JSON.stringify(lineages))
      invalid("State execution identity changed");
    return exact;
  }
  const runId = owner.runId;
  const evalGroupId = first.evalGroupId;
  const generation = integer(
    recordStatement(
      connection,
      "SELECT coalesce(max(generation),0)+1 AS gen FROM state_execution WHERE run_id=? AND eval_group_id=?",
    ).get(runId, evalGroupId)?.gen,
  );
  recordStatement(connection, `INSERT INTO state_execution VALUES (?,?,?,?,?,?,?)`).run(
    owner.executionId,
    runId,
    set.experimentId,
    evalGroupId,
    generation,
    owner.writerGeneration,
    set.id,
  );
  const insert = recordStatement(
    connection,
    `INSERT INTO state_lineage(id,name,version,cohort,experiment_id,eval_group_id,head_id)
    VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(id) DO NOTHING`,
  );
  for (const lineage of lineages) {
    insert.run(
      stateLineageId(lineage),
      lineage.name,
      lineage.version,
      lineage.cohort,
      lineage.experimentId,
      lineage.evalGroupId,
    );
  }
  const state = readStateOrigins(connection, lineages);
  const bind = recordStatement(connection, "INSERT INTO state_execution_binding VALUES (?,?,?,?)");
  state.forEach(({ lineage, origin }, index) =>
    bind.run(
      owner.executionId,
      index,
      stateLineageId(lineage),
      origin.kind === "fresh" ? null : origin.checkpoint.checkpointId,
    ),
  );
  return appendFact(
    connection,
    {
      executionId: owner.executionId,
      runId,
      experimentId: set.experimentId,
      evalGroupId,
      generation,
      bindings: [state[0]!, ...state.slice(1)],
      restore: { status: "pending" },
      save: { status: "pending" },
    },
    clock.nextRevision(connection),
    owner.writerGeneration,
  );
}

function requireCheckpointOwner(connection: RecordDatabase, owner: StateExecutionWriter, id: string) {
  const row = recordStatement(
    connection,
    `SELECT * FROM state_checkpoint WHERE id=? AND execution_id=? AND source_run_id=?`,
  ).get(id, owner.executionId, owner.runId);
  return row ?? invalid("State checkpoint does not belong to its writing execution");
}

function readChunk(connection: RecordDatabase, id: string, ordinal: number) {
  const row = recordStatement(
    connection,
    "SELECT bytes FROM state_checkpoint_chunk WHERE checkpoint_id=? AND ordinal=?",
  ).get(id, ordinal);
  if (row === undefined) return undefined;
  const bytes = row.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > stateChunkLimit)
    invalid("Invalid State checkpoint chunk");
  return bytes;
}

function requireOrigin(connection: RecordDatabase, executionId: string, id: string) {
  if (
    recordStatement(connection, "SELECT 1 FROM state_execution_binding WHERE execution_id=? AND predecessor_id=?").get(
      executionId,
      id,
    ) === undefined
  ) {
    invalid("Checkpoint is not a frozen origin of this execution");
  }
}

function discardStaging(connection: RecordDatabase, executionId: string) {
  recordStatement(connection, "DELETE FROM state_checkpoint WHERE execution_id=? AND ready=0").run(executionId);
}

function sameCheckpoints(left: readonly StateCheckpoint[], right: readonly StateCheckpoint[]): boolean {
  return (
    left.length === right.length &&
    left.every((checkpoint, index) => {
      const other = right[index];
      return (
        checkpoint.checkpointId === other?.checkpointId &&
        checkpoint.digest === other.digest &&
        checkpoint.bytes === other.bytes
      );
    })
  );
}

function validateSaved(connection: RecordDatabase, fact: StateExecution) {
  if (fact.save.status !== "saved") return;
  const archives = fact.save.checkpoints.map((checkpoint, index) => {
    const binding = fact.bindings[index]!;
    const row = recordStatement(
      connection,
      `SELECT 1 FROM state_checkpoint
      WHERE id=? AND execution_id=? AND source_run_id=? AND lineage_id=? AND ready=1`,
    ).get(checkpoint.checkpointId, fact.executionId, fact.runId, stateLineageId(binding.lineage));
    if (row === undefined) invalid("Saved State fact is missing its exact checkpoint");
    return readCheckpoint(connection, checkpoint.checkpointId).checkpoint;
  });
  if (!sameCheckpoints(fact.save.checkpoints, archives)) invalid("Saved State fact disagrees with stored checkpoint");
}

export function finishRunStateRecovery(connection: RecordDatabase, runId: string, writer: string, revision: number) {
  const result = readRunSandboxState(connection, runId, revision);
  if (result.status !== "known") return;
  for (const fact of result.executions) {
    validateSaved(connection, fact);
    if (fact.restore.status === "pending" || fact.save.status === "pending" || fact.save.status === "unknown") {
      discardStaging(connection, fact.executionId);
      appendFact(
        connection,
        {
          ...fact,
          restore: fact.restore.status === "pending" ? { status: "failed", reason: "recovered" } : fact.restore,
          save:
            fact.save.status === "pending" || fact.save.status === "unknown"
              ? { status: "skipped", reason: "recovered" }
              : fact.save,
        },
        revision,
        writer,
      );
    }
  }
}

export function requireRunStateTerminal(connection: RecordDatabase, runId: string, revision: number) {
  const result = readRunSandboxState(connection, runId, revision);
  if (
    result.status === "known" &&
    result.executions.some(
      ({ restore, save }) => restore.status === "pending" || save.status === "pending" || save.status === "unknown",
    )
  )
    invalid("Run has unfinished State executions");
}

export function validatePortableState(connection: RecordDatabase, revision: number, deadlineEpochMs: number): void {
  function invalidPortable(message: string): never {
    throw sqliteError("record-database-invalid", "capture-record", message);
  }
  const checkDeadline = () => {
    if (Date.now() >= deadlineEpochMs) {
      throw sqliteError("record-resource-limit-exceeded", "capture-record", "State validation exceeded its deadline");
    }
  };
  if (
    recordStatement(connection, "SELECT 1 FROM state_checkpoint WHERE ready=0 LIMIT 1").get() !== undefined ||
    recordStatement(
      connection,
      "SELECT 1 FROM state_lineage l JOIN state_checkpoint c ON c.id=l.head_id WHERE c.ready!=1 LIMIT 1",
    ).get() !== undefined
  )
    invalidPortable("Portable State contains unpublished checkpoint data");
  for (const row of recordStatement(connection, "SELECT id FROM state_checkpoint ORDER BY id").iterate()) {
    checkDeadline();
    const id = decodeId(row.id);
    const archived = readCheckpoint(connection, id);
    const digest = createHash("sha256");
    let ordinal = 0;
    let bytes = 0;
    const chunks = recordStatement(
      connection,
      "SELECT ordinal,bytes FROM state_checkpoint_chunk WHERE checkpoint_id=? ORDER BY ordinal",
    ).iterate(id);
    for (const chunk of chunks) {
      checkDeadline();
      if (
        integer(chunk.ordinal) !== ordinal++ ||
        !(chunk.bytes instanceof Uint8Array) ||
        chunk.bytes.length > stateChunkLimit
      ) {
        invalidPortable("Portable State checkpoint has an invalid chunk");
      }
      digest.update(chunk.bytes);
      bytes += chunk.bytes.byteLength;
    }
    if (
      archived.chunkCount !== ordinal ||
      archived.checkpoint.bytes !== bytes ||
      archived.checkpoint.digest !== `sha256:${digest.digest("hex")}`
    ) {
      invalidPortable("Portable State checkpoint bytes disagree with its digest");
    }
  }
  for (const { id } of recordStatement(connection, "SELECT id FROM state_execution ORDER BY id").iterate()) {
    checkDeadline();
    const fact = latestFact(connection, decodeId(id), revision);
    if (
      fact === undefined ||
      fact.restore.status === "pending" ||
      fact.save.status === "pending" ||
      fact.save.status === "unknown"
    ) {
      invalidPortable("Portable State execution has no terminal fact");
    }
    validateSaved(connection, fact);
  }
}

function commitState(
  connection: RecordDatabase,
  clock: StateRunClock,
  owner: StateExecutionWriter,
  checkpoints: readonly StateCheckpoint[],
) {
  const previous = latestFact(connection, owner.executionId);
  if (previous?.save.status === "saved") {
    if (previous.runId !== owner.runId || !sameCheckpoints(previous.save.checkpoints, checkpoints)) {
      invalid("State commit retry changed the frozen save command");
    }
    validateSaved(connection, previous);
    return previous;
  }
  const fact = authorizeExecution(connection, clock, owner);
  if (
    fact.restore.status !== "ready" ||
    fact.save.status !== "pending" ||
    checkpoints.length !== fact.bindings.length
  ) {
    invalid("State save requires one complete ready execution");
  }
  for (const [index, checkpoint] of checkpoints.entries()) {
    decodeCheckpoint(checkpoint);
    const staged = requireCheckpointOwner(connection, owner, checkpoint.checkpointId);
    if (
      staged.lineage_id !== stateLineageId(fact.bindings[index]!.lineage) ||
      staged.validated !== 1n ||
      staged.ready !== 0n ||
      !sameCheckpoints([checkpoint], [readCheckpoint(connection, checkpoint.checkpointId, true).checkpoint])
    ) {
      invalid("State save requires its exact validated checkpoints");
    }
  }
  const origins = readStateOrigins(
    connection,
    fact.bindings.map(({ lineage }) => lineage),
  );
  const actual = origins.map(({ origin }) => (origin.kind === "fresh" ? null : origin.checkpoint));
  const conflict = fact.bindings.some(
    ({ origin }, index) =>
      (origin.kind === "fresh" ? null : origin.checkpoint.checkpointId) !== (actual[index]?.checkpointId ?? null),
  );
  const revision = clock.nextRevision(connection);
  if (conflict) {
    discardStaging(connection, owner.executionId);
    return appendFact(connection, { ...fact, save: { status: "conflict", actual } }, revision, owner.writerGeneration);
  }
  for (const [index, checkpoint] of checkpoints.entries()) {
    recordStatement(connection, "UPDATE state_checkpoint SET ready=1 WHERE id=?").run(checkpoint.checkpointId);
    recordStatement(connection, "UPDATE state_lineage SET head_id=? WHERE id=?").run(
      checkpoint.checkpointId,
      stateLineageId(fact.bindings[index]!.lineage),
    );
  }
  return appendFact(connection, { ...fact, save: { status: "saved", checkpoints } }, revision, owner.writerGeneration);
}

export function executeStateCommand(connection: RecordDatabase, clock: StateRunClock, command: StateCommand) {
  switch (command._tag) {
    case "state-start":
      return startExecution(connection, clock, command.owner, command.lineages);
    case "state-read-execution":
      return latestFact(connection, command.executionId);
    case "state-commit":
      return commitState(connection, clock, command.owner, command.checkpoints);
  }
  const owner = command.owner;
  const fact = authorizeExecution(connection, clock, owner);
  switch (command._tag) {
    case "state-restore-result": {
      if (fact.restore.status !== "pending" || fact.save.status !== "pending") invalid("State restore already settled");
      const reason = command.reason;
      return appendFact(
        connection,
        reason === undefined
          ? { ...fact, restore: { status: "ready" } }
          : {
              ...fact,
              restore: { status: "failed", reason },
              save: { status: "skipped", reason },
            },
        clock.nextRevision(connection),
        owner.writerGeneration,
      );
    }
    case "state-save-failure": {
      if (fact.save.status !== "pending") return fact;
      if (command.result.status !== "unknown") discardStaging(connection, fact.executionId);
      return appendFact(
        connection,
        { ...fact, save: command.result },
        clock.nextRevision(connection),
        owner.writerGeneration,
      );
    }
    case "state-origin-info":
      requireOrigin(connection, owner.executionId, command.id);
      return readCheckpoint(connection, command.id);
    case "state-origin-chunk":
      requireOrigin(connection, owner.executionId, command.id);
      return readChunk(connection, command.id, command.ordinal);
    case "state-stage-read":
      requireCheckpointOwner(connection, owner, command.id);
      return readChunk(connection, command.id, command.ordinal);
    case "state-stage-start": {
      if (fact.restore.status !== "ready" || fact.save.status !== "pending")
        invalid("State staging requires ready restore");
      const binding = fact.bindings[command.ordinal];
      if (binding === undefined) invalid("Checkpoint has no State binding");
      const manifest = JSON.stringify(decodeManifest(command.manifest));
      recordStatement(
        connection,
        `INSERT INTO state_checkpoint
        (id,lineage_id,execution_id,source_run_id,digest,manifest_json,bytes,chunk_count,validated,ready)
        VALUES (?,?,?,?,?,?,0,0,0,0) ON CONFLICT(id) DO NOTHING`,
      ).run(
        decodeId(command.id),
        stateLineageId(binding.lineage),
        owner.executionId,
        owner.runId,
        emptyDigest,
        manifest,
      );
      const row = requireCheckpointOwner(connection, owner, command.id);
      if (row.manifest_json !== manifest || row.lineage_id !== stateLineageId(binding.lineage))
        invalid("Checkpoint staging retry changed the frozen identity");
      return true;
    }
    case "state-stage-chunk": {
      const row = requireCheckpointOwner(connection, owner, command.id);
      const exact = readChunk(connection, command.id, command.ordinal);
      if (exact !== undefined) {
        if (!Buffer.from(exact).equals(command.bytes)) invalid("Checkpoint chunk retry changed the frozen bytes");
        return true;
      }
      if (row.validated !== 0n || command.ordinal !== integer(row.chunk_count))
        invalid("Checkpoint chunk is sealed or out of sequence");
      recordStatement(connection, "INSERT INTO state_checkpoint_chunk VALUES (?,?,?)").run(
        command.id,
        command.ordinal,
        command.bytes,
      );
      recordStatement(connection, "UPDATE state_checkpoint SET chunk_count=chunk_count+1,bytes=bytes+? WHERE id=?").run(
        command.bytes.byteLength,
        command.id,
      );
      return true;
    }
    case "state-stage-seal": {
      const checkpoint = decodeCheckpoint(command.checkpoint);
      const row = requireCheckpointOwner(connection, owner, checkpoint.checkpointId);
      if (
        row.ready !== 0n ||
        integer(row.chunk_count) !== command.chunkCount ||
        integer(row.bytes) !== checkpoint.bytes ||
        (row.validated === 1n && row.digest !== checkpoint.digest)
      )
        invalid("Checkpoint changed during verification");
      recordStatement(connection, "UPDATE state_checkpoint SET digest=?,validated=1 WHERE id=?").run(
        checkpoint.digest,
        checkpoint.checkpointId,
      );
      return true;
    }
  }
}
