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
} from "../record/family/assertions.ts";
import type { SourcesAttachment } from "../record/family/sources.ts";
import {
  assertionsRuntimeSourceCaptureSnapshot,
  attachAssertionsRuntimeSourceCapture,
  markAssertionsRuntimeSourceCaptureInterrupted,
  type AssertionRuntimeSourceSite,
  type AssertionsRuntimeSourceCaptureSnapshot,
} from "../assertions/runtime.ts";
import type { AssertionsRuntime } from "../assertions/api.ts";
import type { AssertionEntryId } from "../assertions/identity.ts";
import { captureLoc, type SourceRegistry } from "../source-loc.ts";
import type { SourceArtifact, SourceLoc, SourcePathFrame } from "../shared/types.ts";
import { createSourcesAttachmentWrite } from "../sources/attachment.ts";
import {
  canonicalizeSourceText,
  isStrictUnicodeText,
} from "../sources/codec.ts";
import type { EvalResult } from "./types.ts";

interface CapturedSite {
  readonly location: SourceLoc;
  readonly sourceOrder: number;
}

interface CapturedSend {
  readonly site: CapturedSite;
  readonly terminal: {
    readonly label: string;
    readonly status: "completed" | "failed";
    readonly durationMs: number;
  };
}

/** Package-internal runtime facts retained outside the public sealed value. */
export interface RunnerAttemptSourceCaptureSnapshot {
  readonly entries: AssertionsRuntimeSourceCaptureSnapshot["entries"];
  readonly sends: readonly CapturedSend[];
}

export interface RunnerAttemptSourceCapture {
  /** One Attempt-wide allocator shared by Assert-first registrations and sends. */
  readonly nextSourceOrder: () => number;
  /** Binds the original Assert-first runtime to its private source journal. */
  readonly attachAssertions: (runtime: AssertionsRuntime<"pass" | "score">) => void;
  /** Receives the exact Runner turn terminal fact, never reconstructs one from events. */
  readonly onTurn: (input: {
    readonly label: string;
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
      readonly label: string;
      readonly durationMs: number;
      readonly failed?: boolean;
      readonly loc?: SourceLoc;
      readonly sourceOrder?: number;
    }) {
      if (input.loc === undefined || input.sourceOrder === undefined) return;
      const site: CapturedSite = Object.freeze({
        location: cloneLocation(input.loc),
        sourceOrder: input.sourceOrder,
      });
      sends.push(Object.freeze({
        site,
        terminal: Object.freeze({
          label: input.label,
          status: input.failed ? "failed" : "completed",
          durationMs: input.durationMs,
        }),
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
        sends: Object.freeze(sends.map((send) => Object.freeze({
          site: send.site,
          terminal: send.terminal,
        }))),
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
  readonly sourceSitesBySlot: ReadonlyMap<SlotId, readonly AssertionSourceSite[]>;
}

export interface RunnerSourceProducerInvalid {
  readonly code: "runner-source-producer-invalid";
  readonly reason:
    | "origin-slot-duplicate"
    | "sources-write-invalid"
    | "sources-closure-invalid"
    | "source-sites-invalid";
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
    sourceSitesBySlot: new Map(sourceSitesBySlot),
  }));
}
