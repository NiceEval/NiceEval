import { Effect, Layer } from "effect";
import {
  enterRecordSnapshotBarrierNode,
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

const nodeRecordCoordination: RecordCoordinationService = {
  enterRecordRead: () => localWitness("read"),
  enterRecordAppend: () => localWitness("append"),
  enterRecordMaintenance: (root) =>
    enterRecordSnapshotBarrierNode({
      root,
      deadlineEpochMs: Date.now() + MAINTENANCE_DEADLINE_MILLISECONDS,
    }).pipe(Effect.as(issueRecordLease("maintenance"))),
  enterRecordWriteBatch: enterRecordWriteBatchNode,
  enterRecordSnapshotBarrier: enterRecordSnapshotBarrierNode,
};

export const NodeRecordCoordinationLive = Layer.succeed(
  RecordCoordination,
  nodeRecordCoordination,
);
