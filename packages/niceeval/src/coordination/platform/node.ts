import { Effect, Layer } from "effect";
import { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import {
  enterRecordWriteFreezeNode,
  enterRecordWriteBatchNode,
} from "./node-record-admission.ts";
import {
  RecordCoordination,
  issueRecordLease,
  type RecordCoordinationService,
} from "../record-leases.ts";

const MAINTENANCE_DEADLINE_MILLISECONDS = 30_000;

/**
 * Ordinary SQLite readers do not hold a transaction between fixed operations,
 * and append writers are coordinated per bounded transaction below. These
 * scoped witnesses deliberately carry no filesystem authority.
 */
function localWitness(kind: "read" | "append") {
  return Effect.acquireRelease(
    Effect.succeed(issueRecordLease(kind)),
    () => Effect.void,
  );
}

function makeNodeRecordCoordination(database: ProjectStateDatabase["Service"]): RecordCoordinationService {
  const provideDatabase = <A, E, R>(effect: Effect.Effect<A, E, R | ProjectStateDatabase>) =>
    Effect.provideService(effect, ProjectStateDatabase, database) as Effect.Effect<A, E, R>;
  return {
  enterRecordRead: () => localWitness("read"),
  enterRecordAppend: () => localWitness("append"),
  enterRecordMaintenance: (root) =>
    provideDatabase(enterRecordWriteFreezeNode({
      root,
      deadlineEpochMs: Date.now() + MAINTENANCE_DEADLINE_MILLISECONDS,
    }).pipe(Effect.as(issueRecordLease("maintenance")))),
    enterRecordWriteBatch: (request) => provideDatabase(enterRecordWriteBatchNode(request)),
    enterRecordWriteFreeze: (request) => provideDatabase(enterRecordWriteFreezeNode(request)),
  };
}

export const NodeRecordCoordinationLive = Layer.effect(
  RecordCoordination,
  Effect.map(ProjectStateDatabase, makeNodeRecordCoordination),
);
