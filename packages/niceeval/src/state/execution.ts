import { createHash, randomBytes } from "node:crypto";
import type { StateCheckpointArchive, StateCommand, StateExecutionWriter } from "../record/sqlite/state-repository.ts";
import type { SharedStateFacet } from "../record/sqlite/project-state-database.ts";
import type { StorageWorkerResult } from "../record/sqlite/worker-protocol.ts";
import {
  StateFileError,
  StateQuiescenceError,
  StateRootPreexistingError,
  type SandboxStateFiles,
} from "../sandbox/state-files.ts";
import type { SandboxAction } from "../sandbox/action.ts";
import { pathsOverlap, type PlannedGroupState } from "./planning.ts";
import type { AttemptState, StateCheckpoint, StateExecution, StateFailureReason, StateManifest } from "./protocol.ts";

const CHUNK_BYTES = 1024 * 1024;
const newIdentity = () => randomBytes(16).toString("hex");

export class SandboxStateFailure extends Error {
  readonly reason: StateFailureReason;
  readonly retainLease: boolean;
  readonly code: StateFileError["code"] | "state-layout-mismatch" | undefined;

  constructor(reason: StateFailureReason, retainLease: boolean, cause?: unknown) {
    super(
      cause instanceof StateFileError
        ? `${cause.code}: ${cause.message}`
        : reason === "layout-mismatch"
          ? "state-layout-mismatch: The State checkpoint layout changed. Declare a new State version."
          : `Sandbox State failed: ${reason}.`,
      { cause },
    );
    this.reason = reason;
    this.retainLease = retainLease;
    this.code =
      cause instanceof StateFileError ? cause.code : reason === "layout-mismatch" ? "state-layout-mismatch" : undefined;
  }
}

export interface DurableGroupState {
  readonly context: () => AttemptState;
  readonly markAttemptEntered: () => void;
  readonly save: (reason: StateFailureReason | undefined, signal: AbortSignal) => Promise<void>;
}

type RestoreEvent =
  | { readonly kind: "restored"; readonly checkpoint: StateCheckpoint }
  | { readonly kind: "initialized" | "empty" };
export type StateFeedback =
  | RestoreEvent
  | { readonly kind: "saved"; readonly checkpoint: StateCheckpoint }
  | {
      readonly kind: "restore-failed" | "save-skipped" | "save-failed";
      readonly reason: StateFailureReason;
    }
  | { readonly kind: "save-unknown"; readonly reason: "storage-failed" }
  | {
      readonly kind: "save-conflict";
      readonly expected: StateCheckpoint | null;
      readonly actual: StateCheckpoint | null;
    };

export interface GroupStateWriter {
  readonly plan: PlannedGroupState;
  readonly writer: Omit<StateExecutionWriter, "executionId">;
  readonly store: SharedStateFacet;
  readonly report: (
    execution: StateExecution,
    index: number,
    event: StateFeedback,
    failure?: SandboxStateFailure,
  ) => void;
}

function sameLayout(previous: StateManifest, current: StateManifest): boolean {
  return (
    previous.roots.length === current.roots.length &&
    previous.roots.every(
      (root, index) =>
        root.declared === current.roots[index]?.declared && root.resolved === current.roots[index]?.resolved,
    )
  );
}

function validateLayout(layouts: readonly StateManifest[], workdir: string) {
  const roots: string[] = [];
  for (const { roots: layout } of layouts) {
    for (const { resolved } of layout) {
      if (pathsOverlap(resolved, workdir))
        throw new StateFileError(
          "state-path-in-workdir",
          `State path ${JSON.stringify(resolved)} overlaps the Sandbox workdir.`,
        );
      if (roots.some((other) => pathsOverlap(other, resolved)))
        throw new StateFileError(
          "state-path-conflict",
          `State path ${JSON.stringify(resolved)} overlaps another State root.`,
        );
      roots.push(resolved);
    }
  }
}

function outcomeCall(store: SharedStateFacet, command: StateCommand) {
  return store.sandbox<StateExecution>(command);
}

async function* readArchive(
  store: SharedStateFacet,
  owner: StateExecutionWriter,
  archive: StateCheckpointArchive,
  signal: AbortSignal,
) {
  let bytes = 0;
  const hash = createHash("sha256");
  for (let ordinal = 0; ordinal < archive.chunkCount; ordinal++) {
    signal.throwIfAborted();
    const chunk = await store.sandbox<Uint8Array | undefined>({
      _tag: "state-origin-chunk",
      id: archive.checkpoint.checkpointId,
      owner,
      ordinal,
    });
    if (chunk === undefined) throw new SandboxStateFailure("checkpoint-invalid", false);
    hash.update(chunk);
    bytes += chunk.byteLength;
    yield chunk;
  }
  if (bytes !== archive.checkpoint.bytes || `sha256:${hash.digest("hex")}` !== archive.checkpoint.digest) {
    throw new SandboxStateFailure("checkpoint-invalid", false);
  }
}

async function stageArchive(input: {
  readonly owner: StateExecutionWriter;
  readonly store: SharedStateFacet;
  readonly ordinal: number;
  readonly expected: StateManifest;
  readonly capture: Awaited<ReturnType<SandboxStateFiles["capture"]>>;
  readonly signal: AbortSignal;
}) {
  const { capture, ordinal, owner, expected, store, signal } = input;
  async function write<A extends StorageWorkerResult>(command: StateCommand) {
    try {
      return await store.sandbox<A>(command);
    } catch (cause) {
      throw new SandboxStateFailure("storage-failed", false, cause);
    }
  }
  if (!sameLayout(expected, capture.manifest)) throw new SandboxStateFailure("layout-mismatch", false);
  const id = newIdentity();
  await write({ _tag: "state-stage-start", id, ordinal, owner, manifest: capture.manifest });
  let chunkCount = 0;
  let bytes = 0;
  const sourceHash = createHash("sha256");
  for await (const data of capture.chunks) {
    for (let offset = 0; offset < data.byteLength; offset += CHUNK_BYTES) {
      signal.throwIfAborted();
      const chunk = data.slice(offset, offset + CHUNK_BYTES);
      sourceHash.update(chunk);
      await write({ _tag: "state-stage-chunk", id, ordinal: chunkCount++, owner, bytes: chunk });
      bytes += chunk.byteLength;
    }
  }
  const readHash = createHash("sha256");
  let readBytes = 0;
  for (let ordinal = 0; ordinal < chunkCount; ordinal++) {
    signal.throwIfAborted();
    const chunk = await write<Uint8Array | undefined>({ _tag: "state-stage-read", id, owner, ordinal });
    if (chunk === undefined) throw new SandboxStateFailure("storage-failed", false);
    readHash.update(chunk);
    readBytes += chunk.byteLength;
  }
  const digest = `sha256:${sourceHash.digest("hex")}`;
  if (readBytes !== bytes || `sha256:${readHash.digest("hex")}` !== digest) {
    throw new SandboxStateFailure("storage-failed", false);
  }
  const checkpoint = { checkpointId: id, digest, bytes };
  await write({ _tag: "state-stage-seal", owner, checkpoint, chunkCount });
  return checkpoint;
}

export async function restoreGroupState(
  input: GroupStateWriter & {
    readonly files: SandboxStateFiles;
    readonly workdir: string;
    readonly signal: AbortSignal;
    readonly initialize: (action: SandboxAction) => Promise<void>;
  },
): Promise<DurableGroupState> {
  const { plan, store, files, signal, report } = input;
  const owner = { ...input.writer, executionId: newIdentity() };
  const start = await outcomeCall(store, {
    _tag: "state-start",
    owner,
    lineages: plan.bindings.map(({ lineage }) => lineage),
  });
  let layouts: readonly StateManifest[];
  let currentBinding = 0;
  const events: RestoreEvent[] = [];
  let stage: StateFailureReason = "path-invalid";
  try {
    const resolved: StateManifest[] = [];
    for (const { definition } of plan.bindings) resolved.push(await files.resolve(definition.paths, signal));
    layouts = resolved;
    validateLayout(layouts, input.workdir);
    stage = "checkpoint-invalid";
    const archives = await Promise.all(
      start.bindings.map(({ origin }) =>
        origin.kind === "fresh"
          ? undefined
          : store.sandbox<StateCheckpointArchive>({
              _tag: "state-origin-info",
              owner,
              id: origin.checkpoint.checkpointId,
            }),
      ),
    );
    for (const [index, archive] of archives.entries()) {
      if (archive !== undefined && !sameLayout(archive.manifest, layouts[index]!)) {
        currentBinding = index;
        throw new SandboxStateFailure("layout-mismatch", false);
      }
    }
    stage = "restore-failed";
    for (const [index, layout] of layouts.entries()) {
      const preexisting = layout.roots.find((root) => root.present);
      if (preexisting !== undefined) {
        currentBinding = index;
        throw new StateRootPreexistingError(preexisting.resolved);
      }
    }
    for (const [index] of layouts.entries()) {
      currentBinding = index;
      signal.throwIfAborted();
      const archive = archives[index];
      stage = "restore-failed";
      if (archive !== undefined) {
        await files.restore(archive.manifest, readArchive(store, owner, archive, signal), signal);
        events.push({ kind: "restored", checkpoint: archive.checkpoint });
      } else {
        const action = plan.bindings[index]!.definition.initialize;
        if (action !== undefined) {
          stage = "initialize-failed";
          await input.initialize(action);
        }
        events.push({ kind: action === undefined ? "empty" : "initialized" });
      }
    }
  } catch (cause) {
    const failure =
      cause instanceof SandboxStateFailure
        ? cause
        : new SandboxStateFailure(
            signal.aborted ? "interrupted" : cause instanceof StateQuiescenceError ? "not-quiescent" : stage,
            cause instanceof StateQuiescenceError,
            cause,
          );
    const failed = await outcomeCall(store, { _tag: "state-restore-result", owner, reason: failure.reason });
    report(failed, currentBinding, { kind: "restore-failed", reason: failure.reason }, failure);
    failed.bindings.forEach((_, index) => report(failed, index, { kind: "save-skipped", reason: failure.reason }));
    throw failure;
  }
  const restored = await outcomeCall(store, { _tag: "state-restore-result", owner });
  events.forEach((event, index) => report(restored, index, event));
  let earlierAttempts = 0;
  return {
    context: () => ({ executionId: owner.executionId, earlierAttempts }),
    markAttemptEntered: () => {
      earlierAttempts++;
    },
    save: async (reason, cleanupSignal) => {
      const skip = reason ?? (earlierAttempts === 0 ? "no-attempts" : undefined);
      const terminalFailure = async (
        kind: "save-skipped" | "save-failed",
        reason: StateFailureReason,
        retainLease: boolean,
        cause?: unknown,
      ) => {
        const settled = await outcomeCall(store, {
          _tag: "state-save-failure",
          owner,
          result: { status: kind === "save-skipped" ? "skipped" : "failed", reason },
        });
        settled.bindings.forEach((_, index) => report(settled, index, { kind, reason }));
        if (reason !== "no-attempts") throw new SandboxStateFailure(reason, retainLease, cause);
      };
      if (skip !== undefined) return terminalFailure("save-skipped", skip, false);
      const checkpoints: StateCheckpoint[] = [];
      let quiescent: boolean;
      try {
        quiescent = await files.withQuiescence(cleanupSignal, async () => {
          for (const [ordinal, expected] of layouts.entries()) {
            const capture = await files.capture(expected, cleanupSignal);
            checkpoints.push(await stageArchive({ owner, store, ordinal, expected, capture, signal: cleanupSignal }));
          }
        });
      } catch (cause) {
        if (cause instanceof StateQuiescenceError) {
          return terminalFailure("save-skipped", "not-quiescent", true, cause);
        }
        const reason = cause instanceof SandboxStateFailure ? cause.reason : "capture-failed";
        return terminalFailure("save-failed", reason, false, cause);
      }
      if (!quiescent) return terminalFailure("save-skipped", "not-quiescent", true);
      let saved: StateExecution;
      try {
        saved = await outcomeCall(store, { _tag: "state-commit", owner, checkpoints });
      } catch (cause) {
        let observed: StateExecution | undefined;
        try {
          observed = await store.sandbox<StateExecution | undefined>({
            _tag: "state-read-execution",
            executionId: owner.executionId,
          });
        } catch {
          restored.bindings.forEach((_, index) =>
            report(restored, index, { kind: "save-unknown", reason: "storage-failed" }),
          );
          throw new SandboxStateFailure("storage-failed", true, cause);
        }
        if (observed === undefined) throw new SandboxStateFailure("storage-failed", true, cause);
        if (observed.save.status !== "saved" && observed.save.status !== "conflict") {
          return terminalFailure("save-failed", "storage-failed", false, cause);
        }
        saved = observed;
      }
      if (saved.save.status === "saved") {
        saved.save.checkpoints.forEach((checkpoint, index) => report(saved, index, { kind: "saved", checkpoint }));
        return;
      }
      if (saved.save.status === "conflict") {
        saved.save.actual.forEach((actual, index) => {
          const origin = saved.bindings[index]!.origin;
          report(saved, index, {
            kind: "save-conflict",
            expected: origin.kind === "fresh" ? null : origin.checkpoint,
            actual,
          });
        });
        throw new SandboxStateFailure("owner-lost", false);
      }
      throw new SandboxStateFailure("storage-failed", true);
    },
  };
}
