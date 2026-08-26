import { randomBytes } from "node:crypto";

import { Either, Schema } from "effect";

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
import { sourcesRecordAttachment } from "../record/family/sources/definition.ts";
import {
  TurnContextsAttachmentSchema,
  type TurnContextsAttachment,
} from "../record/family/turn-contexts/definition.ts";
import type { RecordAttachmentSessionBuilder } from "../record/writer/current-attachment.ts";
import {
  assertionsRuntimeSourceCaptureSnapshot,
  attachAssertionsRuntimeSourceCapture,
  markAssertionsRuntimeSourceCaptureInterrupted,
  type AssertionRuntimeSourceSite,
  type AssertionsRuntimeSourceCaptureSnapshot,
} from "../assertions/runtime.ts";
import type { AssertionsRuntime } from "../assertions/api.ts";
import type { AssertionEntryId } from "../assertions/identity.ts";
import type { TurnId } from "../record/family/source-receipt/model.ts";
import { makeSafeIdentifier } from "../record/family/source-receipt/model.ts";
import { captureLoc, type SourceRegistry } from "../source-loc.ts";
import type { SourceArtifact, SourceLoc, SourcePathFrame } from "../shared/types.ts";
import {
  createSourcesAttachment,
  type SourcesAttachmentBuild,
  type SourcesAttachmentPlan,
} from "../sources/attachment.ts";
import {
  canonicalizeSourceText,
  isStrictUnicodeText,
} from "../sources/codec.ts";
import type { EvalResult } from "./types.ts";

interface CapturedSend {
  readonly segmentId: string;
  readonly turnId: TurnId;
  readonly sessionIndex: number;
  readonly turnIndex: number;
  readonly sourceOrder: number | null;
  readonly location: SourceLoc | undefined;
}

/** Package-internal runtime facts retained outside the public sealed value. */
export interface RunnerAttemptSourceCaptureSnapshot {
  readonly entries: AssertionsRuntimeSourceCaptureSnapshot["entries"];
  readonly sends: readonly CapturedSend[];
  readonly captureFailed: boolean;
}

export interface RunnerAttemptSourceCapture {
  /** One Attempt-wide allocator shared by Assert-first registrations and sends. */
  readonly nextSourceOrder: () => number;
  /** Binds the original Assert-first runtime to its private source journal. */
  readonly attachAssertions: (runtime: AssertionsRuntime<"pass" | "score">) => void;
  /** Captures SessionManager context synchronously before Adapter invocation. */
  readonly onTurnStart: (input: {
    readonly turnId: TurnId;
    readonly sessionIndex: number;
    readonly turnIndex: number;
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
  let captureFailed = false;
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
    onTurnStart(input: {
      readonly turnId: TurnId;
      readonly sessionIndex: number;
      readonly turnIndex: number;
      readonly loc?: SourceLoc;
      readonly sourceOrder?: number;
    }) {
      let segmentId: string | undefined;
      try {
        segmentId = makeSafeIdentifier(`seg.${randomBytes(16).toString("hex")}`);
      } catch {
        segmentId = undefined;
      }
      if (segmentId === undefined) {
        captureFailed = true;
        return;
      }
      sends.push(Object.freeze({
        segmentId,
        turnId: input.turnId,
        sessionIndex: input.sessionIndex,
        turnIndex: input.turnIndex,
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
        captureFailed,
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
  /** Exact current Sources value constructor for the Run owner session. */
  readonly sources: SourcesAttachmentBuild;
  readonly sourceSitesBySlot: ReadonlyMap<SlotId, RunnerAssertionSourceSitesBuild>;
}

export type RunnerAssertionSourceSitesBuild = (
  build: RecordAttachmentSessionBuilder,
) => readonly AssertionSourceSite[];

export type RunnerTurnContextsAttachmentBuild = (
  build: RecordAttachmentSessionBuilder,
) => TurnContextsAttachment;

export interface RunnerSourceProducerInvalid {
  readonly code: "runner-source-producer-invalid";
  readonly reason:
    | "origin-slot-duplicate"
    | "sources-write-invalid"
    | "sources-closure-invalid"
    | "source-sites-invalid"
    | "turn-contexts-invalid";
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

const sourceManifestByPlan = new WeakMap<RunnerSourceWritePlan, SourceManifestLookup>();

function manifestLookup(document: SourcesAttachmentPlan): SourceManifestLookup {
  const files = new Map<CanonicalProjectRelativePath, SourceItemLookup>();
  for (const item of document.items) {
    files.set(item.path, {
      sourceItemId: item.sourceItemId,
      sha256: item.sha256,
      text: item.text,
    });
  }
  return Object.freeze({ files });
}

interface PendingAssertionSourceSite {
  readonly entryId: AssertionEntryId;
  readonly sourceOrder: number;
  readonly role: AssertionSourceSite["role"];
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: AssertionSourceSite["start"];
  readonly end: AssertionSourceSite["end"];
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
): PendingAssertionSourceSite | undefined {
  const path = canonicalPath(input.location.file);
  if (path === undefined) return undefined;
  const local = localFiles.get(path);
  const source = lookup.files.get(path);
  if (local === undefined || source === undefined || source.text !== local) return undefined;
  const coordinate = coordinateFor(local, input.location.line, input.location.column);
  if (coordinate === undefined) return undefined;
  return Object.freeze({
    entryId: input.entryId,
    sourceOrder: input.sourceOrder,
    role: input.role,
    sourceItemId: source.sourceItemId,
    sha256: source.sha256,
    start: coordinate,
    end: coordinate,
  });
}

function sourceSiteOrder(
  left: PendingAssertionSourceSite,
  right: PendingAssertionSourceSite,
): number {
  const byEntry = left.entryId.localeCompare(right.entryId);
  return byEntry === 0 ? left.sourceOrder - right.sourceOrder : byEntry;
}

function sourceSitesForOrigin(
  origin: RunnerSourceOriginInput,
  localFiles: ReadonlyMap<CanonicalProjectRelativePath, string>,
  lookup: SourceManifestLookup,
): Either.Either<readonly PendingAssertionSourceSite[], RunnerSourceProducerInvalid> {
  const capture = sourceCaptureForResult(origin.result);
  if (capture === undefined || capture.entries.length !== origin.assertionEntryIds.length) {
    return Either.right(Object.freeze([]));
  }

  const sourceSites: PendingAssertionSourceSite[] = [];
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

  const sourcesAttachment = createSourcesAttachment({
    items: Object.freeze(
      [...textsByPath.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, text]) => Object.freeze({ sourceItemId: sourceItemId(), path, text })),
    ),
  });
  if (Either.isLeft(sourcesAttachment)) return Either.left(invalid("sources-write-invalid"));

  const lookup = manifestLookup(sourcesAttachment.right);

  const sourceSitesBySlot = new Map<SlotId, RunnerAssertionSourceSitesBuild>();
  for (const origin of origins) {
    const local = localBySlot.get(origin.slotId);
    if (local === undefined) return Either.left(invalid("origin-slot-duplicate"));
    const sites = sourceSitesForOrigin(origin, local, lookup);
    if (Either.isLeft(sites)) return Either.left(sites.left);
    sourceSitesBySlot.set(origin.slotId, (build) => {
      const candidate = Object.freeze(sites.right.map((site) => Object.freeze({
        entryId: site.entryId,
        sourceOrder: site.sourceOrder,
        role: site.role,
        source: build.reference.to(sourcesRecordAttachment, {
          sourceItemId: site.sourceItemId,
          sha256: site.sha256,
        }),
        start: site.start,
        end: site.end,
      })));
      const decoded = Schema.validateEither(
        Schema.Array(AssertionSourceSiteSchema),
        RecordExactParseOptions,
      )(candidate);
      if (Either.isLeft(decoded)) {
        throw new Error("Runner source-site capture violated its current schema");
      }
      return Object.freeze(decoded.right);
    });
  }

  const plan = Object.freeze({
    sources: sourcesAttachment.right.value,
    sourceSitesBySlot: new Map(sourceSitesBySlot),
  });
  sourceManifestByPlan.set(plan, lookup);
  return Either.right(plan);
}

function localSourceTexts(result: EvalResult): ReadonlyMap<CanonicalProjectRelativePath, string> {
  const files = new Map<CanonicalProjectRelativePath, string>();
  for (const artifact of result.sources ?? []) {
    const snapshot = sourceSnapshot(artifact);
    if (snapshot !== undefined && !files.has(snapshot.path)) files.set(snapshot.path, snapshot.text);
  }
  return files;
}

type PendingTurnContextSource =
  | {
      readonly state: "unmapped";
      readonly reason:
        | "location-not-captured"
        | "source-snapshot-not-recorded"
        | "position-unrepresentable";
    }
  | {
      readonly state: "mapped";
      readonly sourceItemId: SourceItemId;
      readonly sha256: Sha256Digest;
      readonly start: { readonly line: number; readonly column: number };
      readonly end: { readonly line: number; readonly column: number };
    };

function turnContextSource(input: {
  readonly capture: CapturedSend;
  readonly local: ReadonlyMap<CanonicalProjectRelativePath, string>;
  readonly sources: SourceManifestLookup;
}): PendingTurnContextSource {
  if (input.capture.location === undefined) {
    return Object.freeze({ state: "unmapped" as const, reason: "location-not-captured" as const });
  }
  const path = canonicalPath(input.capture.location.file);
  if (path === undefined) {
    return Object.freeze({ state: "unmapped" as const, reason: "position-unrepresentable" as const });
  }
  const text = input.local.get(path);
  const item = input.sources.files.get(path);
  if (text === undefined || item === undefined || item.text !== text) {
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
 * Assembles the Attempt-owned storage-neutral context receipt from SessionManager's
 * physical-send capture and the same-seal immutable Sources closure.
 */
export function createRunnerTurnContextsAttachment(input: {
  readonly result: EvalResult;
  readonly sourcePlan: RunnerSourceWritePlan;
}): Either.Either<RunnerTurnContextsAttachmentBuild | undefined, RunnerSourceProducerInvalid> {
  const capture = sourceCaptureForResult(input.result);
  if (capture === undefined) {
    return Either.left(invalid("turn-contexts-invalid"));
  }
  if (capture.sends.length === 0 && !capture.captureFailed) {
    return Either.right(undefined);
  }
  const sources = sourceManifestByPlan.get(input.sourcePlan);
  if (sources === undefined) return Either.left(invalid("sources-closure-invalid"));
  const local = localSourceTexts(input.result);
  const segments = capture.sends.map((captured, index) => Object.freeze({
    segmentId: captured.segmentId,
    sequence: index + 1,
    turnId: captured.turnId,
    sessionIndex: captured.sessionIndex,
    turnIndex: captured.turnIndex,
    sourceOrder: captured.sourceOrder,
    source: turnContextSource({ capture: captured, local, sources }),
  }));
  const limitations: readonly unknown[] = capture.captureFailed
    ? Object.freeze([Object.freeze({
        code: "capture-failed" as const,
        stage: "session-manager" as const,
        target: "turn-context" as const,
      })])
    : Object.freeze([]);
  const collection = limitations.length === 0
    ? Object.freeze({ state: "complete" as const, limitations: Object.freeze([]) })
    : Object.freeze({ state: "partial" as const, limitations: Object.freeze([...limitations]) });
  return Either.right((build) => {
    const candidate = Object.freeze({
      collection,
      segments: Object.freeze(segments.map((segment) => Object.freeze({
        ...segment,
        source: segment.source.state === "unmapped"
          ? segment.source
          : build.reference.to(sourcesRecordAttachment, segment.source),
      }))),
    });
    const decoded = Schema.validateEither(
      TurnContextsAttachmentSchema,
      RecordExactParseOptions,
    )(candidate);
    if (Either.isLeft(decoded)) {
      throw new Error("Runner Turn Context capture violated its current schema");
    }
    return decoded.right;
  });
}
