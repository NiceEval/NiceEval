import { randomBytes } from "node:crypto";

import { Either, Schema } from "effect";

import { recordAttachmentWriteContents } from "../record/attachment/internal.ts";
import type { RecordAttachmentWrite } from "../record/attachment/index.ts";
import {
  CanonicalProjectRelativePathSchema,
  SourceItemIdSchema,
} from "../record/codec/identifiers.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import type {
  CanonicalProjectRelativePath,
  Sha256Digest,
  SlotId,
  SourceItemId,
} from "../record/model/identifiers.ts";
import {
  AssertionSourceSiteSchema,
  type AssertionSourceSite,
} from "../record/family/assertions/definition.ts";
import type { SourcesAttachment } from "../record/family/sources.ts";
import {
  createSourceNavigationAttachmentWrite,
  type SourceNavigationRow,
} from "../record/family/source-navigation.ts";
import { sourceNavigationRecordFamily } from "../record/family/catalog.ts";
import type { AttemptObservabilityAttachment } from "../record/family/observability/definition.ts";
import {
  assertionsRuntimeSourceCaptureSnapshot,
  attachAssertionsRuntimeSourceCapture,
  markAssertionsRuntimeSourceCaptureInterrupted,
  type AssertionRuntimeSourceSite,
  type AssertionsRuntimeSourceCaptureSnapshot,
} from "../assertions/runtime.ts";
import type { AssertionsRuntime } from "../assertions/api.ts";
import type { AssertionEntryId } from "../assertions/identity.ts";
import type { TurnId } from "../o11y/record/model.ts";
import { runnerAttemptConversationTimingForResult } from "../o11y/record/runner-producer.ts";
import { captureLoc, type SourceRegistry } from "../source-loc.ts";
import type { SourceArtifact, SourceLoc, SourcePathFrame } from "../shared/types.ts";
import { createSourcesAttachmentWrite } from "../sources/attachment.ts";
import {
  canonicalizeSourceText,
  isStrictUnicodeText,
} from "../sources/codec.ts";
import type { EvalResult } from "./types.ts";

interface CapturedSend {
  readonly turnId: TurnId;
  readonly sourceOrder: number | null;
  readonly location: SourceLoc | undefined;
}

/** Package-internal runtime facts retained outside the public sealed value. */
export interface RunnerAttemptSourceCaptureSnapshot {
  readonly entries: AssertionsRuntimeSourceCaptureSnapshot["entries"];
  readonly sends: readonly CapturedSend[];
  readonly omittedAtLeast: number;
}

export interface RunnerAttemptSourceCapture {
  /** One Attempt-wide allocator shared by Assert-first registrations and sends. */
  readonly nextSourceOrder: () => number;
  /** Binds the original Assert-first runtime to its private source journal. */
  readonly attachAssertions: (runtime: AssertionsRuntime<"pass" | "score">) => void;
  /** Receives the exact Runner turn terminal fact, never reconstructs one from events. */
  readonly onTurn: (input: {
    /** Undefined means Conversation hit its shared 256-row cap. */
    readonly turnId?: TurnId;
    readonly label: string;
    readonly outcome: "completed" | "failed" | "interrupted";
    readonly events: readonly import("../types.ts").StreamEvent[];
    readonly durationMs: number;
    readonly failed?: boolean;
    readonly loc?: SourceLoc;
    readonly sourceOrder?: number;
  }) => void;
  /** Called only from the Attempt interruption boundary. */
  readonly markInterrupted: () => void;
  readonly snapshot: () => RunnerAttemptSourceCaptureSnapshot;
}

const sourceCaptureByResult = new WeakMap<object, RunnerAttemptSourceCaptureSnapshot>();

/** The sealed EvalResult is the package-internal capability bridge into the Record producer. */
export function retainRunnerAttemptSourceCapture(
  result: EvalResult,
  snapshot: RunnerAttemptSourceCaptureSnapshot,
): EvalResult {
  sourceCaptureByResult.set(result, snapshot);
  return result;
}

function sourceCaptureForResult(
  result: EvalResult,
): RunnerAttemptSourceCaptureSnapshot | undefined {
  return sourceCaptureByResult.get(result);
}

function cloneLocation(value: SourceLoc): SourceLoc {
  const callers: SourcePathFrame[] | undefined = value.callers?.map((frame) =>
    frame.kind === "project"
      ? {
          kind: "project" as const,
          file: frame.file,
          line: frame.line,
          ...(frame.column === undefined ? {} : { column: frame.column }),
        }
      : { kind: "package" as const, package: frame.package },
  );
  return {
    file: value.file,
    line: value.line,
    ...(value.column === undefined ? {} : { column: value.column }),
    ...(callers === undefined ? {} : { callers }),
  };
}

function sourceCaptureFrom(
  registry: SourceRegistry,
  nextSourceOrder: () => number,
): AssertionRuntimeSourceSite | undefined {
  const location = captureLoc({ registry });
  if (location === undefined) return undefined;
  return Object.freeze({ location: cloneLocation(location), sourceOrder: nextSourceOrder() });
}

/**
 * Holds only Attempt-owned package-internal joins. Assert-first owns entry
 * registration/modifier facts; SessionManager owns user-event locations and
 * turn terminals. No author-facing Context value is wrapped or replaced.
 */
export function createRunnerAttemptSourceCapture(
  registry: SourceRegistry,
): RunnerAttemptSourceCapture {
  let sourceOrder = 0;
  const sends: CapturedSend[] = [];
  let omittedAtLeast = 0;
  let assertionsRuntime: AssertionsRuntime<"pass" | "score"> | undefined;
  const nextSourceOrder = (): number => ++sourceOrder;

  return Object.freeze({
    nextSourceOrder,
    attachAssertions(runtime: AssertionsRuntime<"pass" | "score">) {
      if (assertionsRuntime !== undefined && assertionsRuntime !== runtime) {
        throw new Error("Runner source capture cannot observe two Assertions runtimes");
      }
      if (assertionsRuntime === runtime) return;
      attachAssertionsRuntimeSourceCapture(
        runtime,
        () => sourceCaptureFrom(registry, nextSourceOrder),
      );
      assertionsRuntime = runtime;
    },
    onTurn(input: {
      readonly turnId?: TurnId;
      readonly label: string;
      readonly outcome: "completed" | "failed" | "interrupted";
      readonly events: readonly import("../types.ts").StreamEvent[];
      readonly durationMs: number;
      readonly failed?: boolean;
      readonly loc?: SourceLoc;
      readonly sourceOrder?: number;
    }) {
      if (input.turnId === undefined) {
        omittedAtLeast += 1;
        return;
      }
      sends.push(Object.freeze({
        turnId: input.turnId,
        sourceOrder: input.sourceOrder ?? null,
        location: input.loc === undefined ? undefined : cloneLocation(input.loc),
      }));
    },
    markInterrupted() {
      if (assertionsRuntime !== undefined) {
        markAssertionsRuntimeSourceCaptureInterrupted(assertionsRuntime);
      }
    },
    snapshot() {
      const assertions = assertionsRuntime === undefined
        ? undefined
        : assertionsRuntimeSourceCaptureSnapshot(assertionsRuntime);
      return Object.freeze({
        entries: assertions?.entries ?? Object.freeze([]),
        sends: Object.freeze(sends.map((send) => Object.freeze({ ...send }))),
        omittedAtLeast,
      });
    },
  });
}

export interface RunnerSourceOriginInput {
  readonly slotId: SlotId;
  readonly result: EvalResult;
  /** Minted by the same Assertions producer that will write this Attempt. */
  readonly assertionEntryIds: readonly AssertionEntryId[];
}

export interface RunnerSourceWritePlan {
  readonly runWrite: RecordAttachmentWrite<"run", never, never>;
  /** Exact decoded manifest shared by assertion and send navigation joins. */
  readonly sources: SourcesAttachment;
  readonly sourceSitesBySlot: ReadonlyMap<SlotId, readonly AssertionSourceSite[]>;
}

export interface RunnerSourceProducerInvalid {
  readonly code: "runner-source-producer-invalid";
  readonly reason:
    | "origin-slot-duplicate"
    | "sources-write-invalid"
    | "sources-closure-invalid"
    | "source-sites-invalid"
    | "source-navigation-invalid";
}

function invalid(
  reason: RunnerSourceProducerInvalid["reason"],
): RunnerSourceProducerInvalid {
  return Object.freeze({ code: "runner-source-producer-invalid" as const, reason });
}

function canonicalPath(path: string): CanonicalProjectRelativePath | undefined {
  const decoded = Schema.decodeUnknownEither(
    CanonicalProjectRelativePathSchema,
    RecordExactParseOptions,
  )(path);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

interface SourceSnapshot {
  readonly path: CanonicalProjectRelativePath;
  readonly text: string;
}

function sourceSnapshot(value: SourceArtifact): SourceSnapshot | undefined {
  const path = canonicalPath(value.path);
  if (path === undefined || !isStrictUnicodeText(value.content)) return undefined;
  return Object.freeze({ path, text: canonicalizeSourceText(value.content) });
}

function sourceItemId(): SourceItemId {
  const candidate = `src_${randomBytes(10).toString("hex")}`;
  const decoded = Schema.decodeUnknownEither(
    SourceItemIdSchema,
    RecordExactParseOptions,
  )(candidate);
  if (Either.isLeft(decoded)) {
    throw new Error("Runner generated an invalid Sources item identity");
  }
  return decoded.right;
}

function coordinateFor(
  text: string,
  line: number,
  column: number | undefined,
): { readonly line: number; readonly column: number } | undefined {
  if (!Number.isSafeInteger(line) || line < 1 || column === undefined || !Number.isSafeInteger(column) || column < 1) {
    return undefined;
  }
  const row = text.split("\n")[line - 1];
  if (row === undefined || column > row.length + 1) return undefined;
  const before = row.slice(0, column - 1);
  const last = before.charCodeAt(before.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) return undefined;
  return Object.freeze({ line, column: new TextEncoder().encode(before).byteLength + 1 });
}

interface SourceItemLookup {
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly text: string;
}

interface SourceManifestLookup {
  readonly files: Map<CanonicalProjectRelativePath, SourceItemLookup>;
}

function manifestLookup(document: SourcesAttachment): SourceManifestLookup {
  const files = new Map<CanonicalProjectRelativePath, SourceItemLookup>();
  for (const item of document.items) {
    files.set(item.path, {
      sourceItemId: item.sourceItemId,
      sha256: item.sha256,
      // The producer supplies the exact same canonical text separately.
      text: "",
    });
  }
  return Object.freeze({ files });
}

function sourceSite(
  input: {
    readonly entryId: AssertionEntryId;
    readonly sourceOrder: number;
    readonly role: AssertionSourceSite["role"];
    readonly location: SourceLoc;
  },
  localFiles: ReadonlyMap<CanonicalProjectRelativePath, string>,
  lookup: SourceManifestLookup,
): AssertionSourceSite | undefined {
  const path = canonicalPath(input.location.file);
  if (path === undefined) return undefined;
  const local = localFiles.get(path);
  const source = lookup.files.get(path);
  if (local === undefined || source === undefined || source.text !== local) return undefined;
  const coordinate = coordinateFor(local, input.location.line, input.location.column);
  if (coordinate === undefined) return undefined;
  const decoded = Schema.decodeUnknownEither(
    AssertionSourceSiteSchema,
    RecordExactParseOptions,
  )(
    Object.freeze({
      entryId: input.entryId,
      sourceOrder: input.sourceOrder,
      role: input.role,
      sourceItemId: source.sourceItemId,
      sha256: source.sha256,
      start: coordinate,
      end: coordinate,
    }),
  );
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function sourceSiteOrder(
  left: AssertionSourceSite,
  right: AssertionSourceSite,
): number {
  const byEntry = left.entryId.localeCompare(right.entryId);
  return byEntry === 0 ? left.sourceOrder - right.sourceOrder : byEntry;
}

function sourceSitesForOrigin(
  origin: RunnerSourceOriginInput,
  localFiles: ReadonlyMap<CanonicalProjectRelativePath, string>,
  lookup: SourceManifestLookup,
): Either.Either<readonly AssertionSourceSite[], RunnerSourceProducerInvalid> {
  const capture = sourceCaptureForResult(origin.result);
  if (capture === undefined || capture.entries.length !== origin.assertionEntryIds.length) {
    return Either.right(Object.freeze([]));
  }

  const sourceSites: AssertionSourceSite[] = [];
  const orders = new Set<number>();
  for (const [index, entryCapture] of capture.entries.entries()) {
    const entryId = origin.assertionEntryIds[index];
    if (entryId === undefined) return Either.left(invalid("source-sites-invalid"));
    for (const occurrence of entryCapture.occurrences) {
      if (occurrence.site === undefined) continue;
      if (orders.has(occurrence.site.sourceOrder)) {
        return Either.left(invalid("source-sites-invalid"));
      }
      orders.add(occurrence.site.sourceOrder);
      const site = sourceSite({
        entryId,
        sourceOrder: occurrence.site.sourceOrder,
        role: occurrence.role,
        location: occurrence.site.location,
      }, localFiles, lookup);
      if (site !== undefined) sourceSites.push(site);
    }
  }
  sourceSites.sort(sourceSiteOrder);
  return Either.right(Object.freeze(sourceSites));
}

/**
 * Builds one flat Run Sources closure plus semantic source-site joins for
 * each fresh origin. It uses only bytes retained by the actual Attempt; it
 * never reopens today's worktree or a legacy result/Report surface.
 */
export function createRunnerSourceWritePlan(
  origins: readonly RunnerSourceOriginInput[],
): Either.Either<RunnerSourceWritePlan, RunnerSourceProducerInvalid> {
  const textsByPath = new Map<CanonicalProjectRelativePath, string>();
  const localBySlot = new Map<SlotId, ReadonlyMap<CanonicalProjectRelativePath, string>>();

  for (const origin of origins) {
    if (localBySlot.has(origin.slotId)) {
      return Either.left(invalid("origin-slot-duplicate"));
    }
    const local = new Map<CanonicalProjectRelativePath, string>();
    for (const artifact of origin.result.sources ?? []) {
      const snapshot = sourceSnapshot(artifact);
      if (snapshot === undefined) continue;
      if (!local.has(snapshot.path)) local.set(snapshot.path, snapshot.text);
      if (!textsByPath.has(snapshot.path)) textsByPath.set(snapshot.path, snapshot.text);
    }
    localBySlot.set(origin.slotId, local);
  }

  const sourcesWrite = createSourcesAttachmentWrite({
    items: Object.freeze(
      [...textsByPath.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, text]) => Object.freeze({ sourceItemId: sourceItemId(), path, text })),
    ),
  });
  if (Either.isLeft(sourcesWrite)) return Either.left(invalid("sources-write-invalid"));
  const sourceContents = recordAttachmentWriteContents<
    "run",
    SourcesAttachment,
    never,
    never
  >(sourcesWrite.right);
  if (Either.isLeft(sourceContents)) return Either.left(invalid("sources-closure-invalid"));

  const lookup = manifestLookup(sourceContents.right.payload);
  // Retain canonical bytes only in this producer's transient lookup. They let
  // source sites prove a semantic join, not gain a blob capability.
  for (const [path, text] of textsByPath) {
    const item = lookup.files.get(path);
    if (item !== undefined) {
      lookup.files.set(path, Object.freeze({ ...item, text }));
    }
  }

  const sourceSitesBySlot = new Map<SlotId, readonly AssertionSourceSite[]>();
  for (const origin of origins) {
    const local = localBySlot.get(origin.slotId);
    if (local === undefined) return Either.left(invalid("origin-slot-duplicate"));
    const sites = sourceSitesForOrigin(origin, local, lookup);
    if (Either.isLeft(sites)) return Either.left(sites.left);
    sourceSitesBySlot.set(origin.slotId, sites.right);
  }

  return Either.right(Object.freeze({
    runWrite: sourcesWrite.right,
    sources: sourceContents.right.payload,
    sourceSitesBySlot: new Map(sourceSitesBySlot),
  }));
}

function localSourceTexts(result: EvalResult): ReadonlyMap<CanonicalProjectRelativePath, string> {
  const files = new Map<CanonicalProjectRelativePath, string>();
  for (const artifact of result.sources ?? []) {
    const snapshot = sourceSnapshot(artifact);
    if (snapshot !== undefined && !files.has(snapshot.path)) files.set(snapshot.path, snapshot.text);
  }
  return files;
}

function sourceNavigationFrame(input: {
  readonly capture: CapturedSend;
  readonly local: ReadonlyMap<CanonicalProjectRelativePath, string>;
  readonly sources: SourcesAttachment;
}): SourceNavigationRow["source"] {
  if (input.capture.location === undefined) {
    return Object.freeze({ state: "unmapped" as const, reason: "location-not-captured" as const });
  }
  const path = canonicalPath(input.capture.location.file);
  if (path === undefined) {
    return Object.freeze({ state: "unmapped" as const, reason: "position-unrepresentable" as const });
  }
  const text = input.local.get(path);
  const item = input.sources.items.find((candidate) => candidate.path === path);
  if (text === undefined || item === undefined) {
    return Object.freeze({ state: "unmapped" as const, reason: "source-snapshot-not-recorded" as const });
  }
  const position = coordinateFor(text, input.capture.location.line, input.capture.location.column);
  if (position === undefined) {
    return Object.freeze({ state: "unmapped" as const, reason: "position-unrepresentable" as const });
  }
  return Object.freeze({
    state: "mapped" as const,
    sourceItemId: item.sourceItemId,
    sha256: item.sha256,
    start: position,
    end: position,
  });
}

/**
 * Assembles the Attempt-owned no-blob navigation payload only after the
 * same-seal Observability writer has fixed physical turn IDs and timing IDs.
 */
export function createRunnerSourceNavigationWrite(input: {
  readonly result: EvalResult;
  readonly sources: SourcesAttachment;
  readonly observability: AttemptObservabilityAttachment;
}): Either.Either<RecordAttachmentWrite<"attempt", never, never>, RunnerSourceProducerInvalid> {
  const capture = sourceCaptureForResult(input.result);
  const timingByTurn = runnerAttemptConversationTimingForResult(input.result);
  if (capture === undefined || timingByTurn === undefined) {
    return Either.left(invalid("source-navigation-invalid"));
  }
  const turns = [...input.observability.conversation.turns]
    .sort((left, right) => left.sequence - right.sequence);
  if (turns.length !== capture.sends.length) {
    return Either.left(invalid("source-navigation-invalid"));
  }
  const local = localSourceTexts(input.result);
  const rows: SourceNavigationRow[] = [];
  let missingTiming = 0;
  for (const [index, turn] of turns.entries()) {
    const captured = capture.sends[index];
    if (captured === undefined || captured.turnId !== turn.turnId) {
      return Either.left(invalid("source-navigation-invalid"));
    }
    const intervalId = timingByTurn.get(captured.turnId);
    if (intervalId === undefined) missingTiming += 1;
    rows.push(Object.freeze({
      turnId: captured.turnId,
      sourceOrder: captured.sourceOrder,
      source: sourceNavigationFrame({ capture: captured, local, sources: input.sources }),
      timing: intervalId === undefined
        ? Object.freeze({ state: "unavailable" as const, reason: "timing-not-recorded" as const })
        : Object.freeze({ state: "linked" as const, intervalId }),
    }));
  }
  const limitations = [] as (
    | {
      readonly code: "collection-cap-reached";
      readonly target: "navigation-row";
      readonly omittedAtLeast: number;
    }
    | {
      readonly code: "capture-unrecoverable";
      readonly target: "timing-link";
      readonly omittedAtLeast: number;
    }
  )[];
  if (capture.omittedAtLeast > 0) {
    limitations.push(Object.freeze({
      code: "collection-cap-reached" as const,
      target: "navigation-row" as const,
      omittedAtLeast: capture.omittedAtLeast,
    }));
  }
  if (missingTiming > 0) {
    limitations.push(Object.freeze({
      code: "capture-unrecoverable" as const,
      target: "timing-link" as const,
      omittedAtLeast: missingTiming,
    }));
  }
  limitations.sort((left, right) =>
    `${left.code}\u0000${left.target}\u0000${left.omittedAtLeast}`.localeCompare(
      `${right.code}\u0000${right.target}\u0000${right.omittedAtLeast}`,
    )
  );
  const payload = Object.freeze({
    collection: limitations.length === 0
      ? Object.freeze({ state: "complete" as const, limitations: Object.freeze([]) })
      : Object.freeze({ state: "partial" as const, limitations: Object.freeze([...limitations]) }),
    rows: Object.freeze(rows),
  });
  const write = createSourceNavigationAttachmentWrite(payload, sourceNavigationRecordFamily.write);
  return Either.isLeft(write) ? Either.left(invalid("source-navigation-invalid")) : Either.right(write.right);
}
