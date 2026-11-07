// @concord-file
// @concord-implements docs/feature/sandbox/architecture/remote-snapshot-cache.md
import { Schema, type Effect, type Scope } from "effect";
import type { BeforeCacheKeyScope, BeforeCacheUnsupportedCode } from "../backend.ts";
import type { MaterializedSandboxCase } from "../case-types.ts";
import type { SandboxRuntimeMaterializeContext } from "../runtime.ts";

/** Provider failures carry no raw response text or credential values. */
export class BeforeCacheSnapshotError extends Schema.TaggedError<BeforeCacheSnapshotError>()("BeforeCacheSnapshotError", {
  operation: Schema.String,
  reason: Schema.String,
}) {}

export interface BeforeCacheSnapshotTarget {
  readonly _tag: "Resolved";
  readonly executionDomainId: string;
  readonly baseIdentity: string;
  readonly baseReference: string;
  readonly keyScope: BeforeCacheKeyScope;
}

export interface BeforeCacheIneligible {
  readonly _tag: "Ineligible";
  readonly code: BeforeCacheUnsupportedCode;
  readonly reason: string;
}

export type BeforeCacheSnapshotCreated =
  | { readonly _tag: "Ready"; readonly snapshotId: string }
  | { readonly _tag: "Rejected"; readonly reason: string };

export type BeforeCacheSnapshotFound =
  | { readonly _tag: "Ready"; readonly snapshotId: string }
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Absent" };

/** Snapshot primitives only: the module binding owns Provider identity. */
export interface BeforeCacheSnapshotDriver<Plan> {
  readonly preserves: {
    readonly disks: readonly string[];
    readonly memory: boolean;
  };
  readonly sourceUsableAfterSnapshot: boolean;
  readonly snapshotSettleMs: number;
  readonly resolveBase: (plan: Plan) => Effect.Effect<BeforeCacheSnapshotTarget | BeforeCacheIneligible, BeforeCacheSnapshotError>;
  readonly createFromSnapshot: (
    plan: Plan, snapshotId: string, context: SandboxRuntimeMaterializeContext,
  ) => Effect.Effect<MaterializedSandboxCase, BeforeCacheSnapshotError, Scope.Scope>;
  readonly createSnapshot: (
    plan: Plan, source: MaterializedSandboxCase, name: string,
  ) => Effect.Effect<BeforeCacheSnapshotCreated, BeforeCacheSnapshotError>;
  readonly findSnapshot: (plan: Plan, name: string) => Effect.Effect<BeforeCacheSnapshotFound, BeforeCacheSnapshotError>;
  readonly deleteSnapshot: (plan: Plan, snapshotId: string) => Effect.Effect<"deleted" | "absent", BeforeCacheSnapshotError>;
}
