import { randomBytes } from "node:crypto";

import { Either, Schema } from "effect";

import { recordAttachmentWriteContents } from "../record/attachment/internal.ts";
import type {
  RecordAttachmentWrite,
  RecordBlobRef,
} from "../record/attachment/index.ts";
import type { SlotId } from "../record/model/identifiers.ts";
import { captureLoc, type SourceRegistry } from "../source-loc.ts";
import type { SourceArtifact, SourceLoc, SourcePathFrame } from "../shared/types.ts";
import { formatTurnLabel } from "../shared/turn-label.ts";
import {
  createAssertionSourceSitesAttachmentWriteV1,
  createSourcesAttachmentWriteV1,
} from "../sources/attachment.ts";
import {
  CanonicalSourcePathV1Schema,
  SourcesExactParseOptions,
  canonicalizeSourceTextV1,
  isStrictUnicodeTextV1,
} from "../sources/codec.ts";
import type {
  AssertionSourceOccurrenceV1,
  AssertionSourceFileFrameV1,
  AssertionSourceFrameV1,
  AssertionSourceSendSiteV1,
  AssertionSourceSiteV1,
  AssertionSourceSendOccurrenceV1,
  AssertionSourceSitesEntryV1,
  AssertionSourceSitesDocumentV1,
  AssertionSourceTraceV1,
  CanonicalSourcePathV1,
  SourcesDocumentV1,
} from "../sources/model.ts";
import type {
  Sha256Digest,
  SourceFileItemId,
  SourcePackageItemId,
} from "../sources/identity.ts";
import type { AssertionEntryId } from "../assertions/identity.ts";
import type { AssertionsDocumentOuterV1 } from "../assertions/record/model.ts";
import type { EvalResult } from "./types.ts";

type AssertionSourceRole = Exclude<AssertionSourceOccurrenceV1["role"], "stop"> | "stop";

interface CapturedSite {
  readonly location: SourceLoc;
  readonly sourceOrder: number;
}

interface CapturedAssertionOccurrence {
  readonly role: AssertionSourceRole;
  readonly site?: CapturedSite;
  /** A stop only becomes durable after its actual terminal state is known. */
  outcome?: "continued" | "stopped" | "interrupted";
}

interface CapturedAssertionEntry {
  readonly occurrences: CapturedAssertionOccurrence[];
}

interface CapturedSend {
  readonly site?: CapturedSite;
  terminal?: {
    readonly label: string;
    readonly status: "completed" | "failed" | "interrupted";
    readonly durationMs: number;
  };
  ambiguous?: true;
}

/** Package-internal runtime facts retained outside the public sealed value. */
export interface RunnerAttemptSourceCaptureSnapshot {
  readonly entries: readonly {
    readonly occurrences: readonly CapturedAssertionOccurrence[];
  }[];
  readonly sends: readonly CapturedSend[];
}

export interface RunnerAttemptSourceCapture {
  /** Wraps only the author-facing value; no durable type enters the author API. */
  readonly instrument: (context: unknown) => unknown;
  /** Receives the exact Runner turn terminal fact, never reconstructs one from events. */
  readonly onTurn: (input: {
    readonly sessionIndex: number;
    readonly turnIndex: number;
    readonly durationMs: number;
    readonly failed?: boolean;
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

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof Reflect.get(value, "then") === "function";
}

function isAssertionHandle(value: unknown): value is object {
  if (!isObject(value)) return false;
  const kind = Reflect.get(value, "kind");
  return kind === "boolean" || kind === "measurement" || kind === "direct-score";
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

function sourceCaptureFrom(registry: SourceRegistry, nextSourceOrder: () => number): CapturedSite | undefined {
  const location = captureLoc({ registry });
  if (location === undefined) return undefined;
  return Object.freeze({ location: cloneLocation(location), sourceOrder: nextSourceOrder() });
}

function stopOutcome(error: unknown): "stopped" | "interrupted" | undefined {
  if (!isObject(error)) return undefined;
  if (Reflect.get(error, "_tag") === "AssertionStopError") return "stopped";
  return Reflect.get(error, "reason") === "attempt-interrupted" ? "interrupted" : undefined;
}

/**
 * Captures only actions that actually return an Assertion handle or begin a
 * send. The journal is intentionally package-internal: the public sealed
 * assertion value remains source-location agnostic.
 */
export function createRunnerAttemptSourceCapture(
  registry: SourceRegistry,
): RunnerAttemptSourceCapture {
  let sourceOrder = 0;
  const entries: CapturedAssertionEntry[] = [];
  const sends: CapturedSend[] = [];
  const entryForHandle = new WeakMap<object, CapturedAssertionEntry>();
  const proxyForObject = new WeakMap<object, object>();

  const capture = (): CapturedSite | undefined => sourceCaptureFrom(registry, () => ++sourceOrder);

  const recordDeclaration = (site: CapturedSite | undefined): CapturedAssertionEntry => {
    const entry: CapturedAssertionEntry = { occurrences: [] };
    entry.occurrences.push({ role: "declaration", site });
    entries.push(entry);
    return entry;
  };

  const recordModifier = (
    entry: CapturedAssertionEntry,
    role: Exclude<AssertionSourceRole, "declaration" | "stop">,
    site: CapturedSite | undefined,
  ): void => {
    entry.occurrences.push({ role, site });
  };

  const recordStop = (
    entry: CapturedAssertionEntry,
    site: CapturedSite | undefined,
  ): CapturedAssertionOccurrence => {
    const occurrence: CapturedAssertionOccurrence = { role: "stop", site };
    entry.occurrences.push(occurrence);
    return occurrence;
  };

  const wrap = (value: unknown): unknown => {
    if (!isObject(value) || isPromiseLike(value)) return value;
    const known = proxyForObject.get(value);
    if (known !== undefined) return known;

    const proxy = new Proxy(value, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (typeof member !== "function") {
          if (
            (property === "sandbox" || property === "judge" || property === "autoevals")
            && isObject(member)
          ) {
            return wrap(member);
          }
          return member;
        }

        return (...args: readonly unknown[]) => {
          const name = typeof property === "string" ? property : undefined;
          const handleEntry = entryForHandle.get(target);

          if (handleEntry !== undefined) {
            if (name === "orStop") {
              const site = capture();
              const result = Reflect.apply(member, target, args);
              const occurrence = recordStop(handleEntry, site);
              if (!isPromiseLike(result)) return result;
              return Promise.resolve(result).then(
                (resolved) => {
                  occurrence.outcome = "continued";
                  return resolved;
                },
                (error) => {
                  const outcome = stopOutcome(error);
                  if (outcome !== undefined) occurrence.outcome = outcome;
                  throw error;
                },
              );
            }

            const role = name === "atLeast"
              ? "threshold"
              : name === "score"
                ? "score"
                : name === "gate"
                  ? "gate"
                  : name === "optional"
                    ? "optional"
                    : undefined;
            const site = role === undefined ? undefined : capture();
            const result = Reflect.apply(member, target, args);
            if (role !== undefined) recordModifier(handleEntry, role, site);
            return wrap(result);
          }

          const isSend = name === "send"
            || name === "sendFile"
            || name === "respond"
            || name === "respondAll";
          const site = capture();
          const result = Reflect.apply(member, target, args);
          if (isSend) {
            const send: CapturedSend = { site };
            sends.push(send);
            if (!isPromiseLike(result)) return result;
            return Promise.resolve(result).then((resolved) => wrap(resolved));
          }

          if (isAssertionHandle(result)) {
            const entry = recordDeclaration(site);
            entryForHandle.set(result, entry);
            return wrap(result);
          }
          if (name === "newSession") return wrap(result);
          return wrap(result);
        };
      },
    });
    proxyForObject.set(value, proxy);
    return proxy;
  };

  return Object.freeze({
    instrument: (context: unknown) => wrap(context),
    onTurn(input: {
      readonly sessionIndex: number;
      readonly turnIndex: number;
      readonly durationMs: number;
      readonly failed?: boolean;
    }) {
      const pending = sends.filter((send) => send.terminal === undefined && send.ambiguous !== true);
      if (pending.length !== 1) {
        for (const send of pending) send.ambiguous = true;
        return;
      }
      const [send] = pending;
      if (send === undefined) return;
      send.terminal = Object.freeze({
        label: formatTurnLabel(input.sessionIndex, input.turnIndex),
        status: input.failed ? "failed" : "completed",
        durationMs: input.durationMs,
      });
    },
    markInterrupted() {
      for (const send of sends) {
        if (send.terminal === undefined && send.ambiguous !== true) {
          send.terminal = Object.freeze({
            label: "interrupted",
            status: "interrupted",
            durationMs: 0,
          });
        }
      }
      for (const entry of entries) {
        for (const occurrence of entry.occurrences) {
          if (occurrence.role === "stop" && occurrence.outcome === undefined) {
            occurrence.outcome = "interrupted";
          }
        }
      }
    },
    snapshot() {
      return Object.freeze({
        entries: Object.freeze(entries.map((entry) => Object.freeze({
          occurrences: Object.freeze(entry.occurrences.map((occurrence) => Object.freeze({
            role: occurrence.role,
            ...(occurrence.site === undefined ? {} : { site: occurrence.site }),
            ...(occurrence.outcome === undefined ? {} : { outcome: occurrence.outcome }),
          }))),
        }))),
        sends: Object.freeze(sends.map((send) => Object.freeze({
          ...(send.site === undefined ? {} : { site: send.site }),
          ...(send.terminal === undefined ? {} : { terminal: send.terminal }),
          ...(send.ambiguous === true ? { ambiguous: true as const } : {}),
        }))),
      });
    },
  });
}

export interface RunnerSourceOriginInput {
  readonly slotId: SlotId;
  readonly result: EvalResult;
  readonly assertions: RecordAttachmentWrite<"attempt", never, never>;
}

export interface RunnerSourceWritePlan {
  readonly runWrite: RecordAttachmentWrite<"run", never, never>;
  readonly attemptWrites: ReadonlyMap<SlotId, RecordAttachmentWrite<"attempt", never, never>>;
}

export interface RunnerSourceProducerInvalid {
  readonly code: "runner-source-producer-invalid";
  readonly reason:
    | "assertions-closure-invalid"
    | "sources-write-invalid"
    | "sources-closure-invalid"
    | "source-sites-write-invalid"
    | "source-sites-closure-invalid"
    | "source-sites-join-invalid";
}

function invalid(
  reason: RunnerSourceProducerInvalid["reason"],
): RunnerSourceProducerInvalid {
  return Object.freeze({ code: "runner-source-producer-invalid" as const, reason });
}

function canonicalPath(path: string): CanonicalSourcePathV1 | undefined {
  const decoded = Schema.decodeUnknownEither(
    CanonicalSourcePathV1Schema,
    SourcesExactParseOptions,
  )(path);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

interface SourceSnapshot {
  readonly path: CanonicalSourcePathV1;
  readonly text: string;
}

function sourceSnapshot(value: SourceArtifact): SourceSnapshot | undefined {
  const path = canonicalPath(value.path);
  if (path === undefined || !isStrictUnicodeTextV1(value.content)) return undefined;
  return Object.freeze({ path, text: canonicalizeSourceTextV1(value.content) });
}

function stableFileKey(path: CanonicalSourcePathV1): CanonicalSourcePathV1 {
  return path;
}

function packageId(): string {
  return `sp_${randomBytes(10).toString("hex")}`;
}

function fileId(): string {
  return `sf_${randomBytes(10).toString("hex")}`;
}

function sourceFrames(location: SourceLoc): readonly SourcePathFrame[] {
  return Object.freeze([
    ...(location.callers ?? []),
    Object.freeze({
      kind: "project" as const,
      file: location.file,
      line: location.line,
      ...(location.column === undefined ? {} : { column: location.column }),
    }),
  ]);
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

interface SourceFileLookup {
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly sha256: Sha256Digest;
  readonly text: string;
}

interface SourceManifestLookup {
  readonly packages: Map<string, SourcePackageItemId>;
  readonly files: Map<CanonicalSourcePathV1, SourceFileLookup>;
}

function manifestLookup(document: SourcesDocumentV1<RecordBlobRef>): SourceManifestLookup {
  const packages = new Map<string, SourcePackageItemId>();
  const files = new Map<CanonicalSourcePathV1, SourceFileLookup>();
  for (const sourcePackage of document.packages) {
    packages.set(sourcePackage.label, sourcePackage.packageItemId);
    for (const file of sourcePackage.files) {
      files.set(stableFileKey(file.path), {
        packageItemId: sourcePackage.packageItemId,
        fileItemId: file.fileItemId,
        sha256: file.sha256,
        // The producer supplies the exact same canonical text separately.
        text: "",
      });
    }
  }
  return Object.freeze({ packages, files });
}

function assertionEntryIds(
  write: RecordAttachmentWrite<"attempt", never, never>,
): Either.Either<readonly AssertionEntryId[], RunnerSourceProducerInvalid> {
  const contents = recordAttachmentWriteContents<
    "attempt",
    AssertionsDocumentOuterV1<RecordBlobRef>,
    never,
    never
  >(write);
  return Either.isLeft(contents)
    ? Either.left(invalid("assertions-closure-invalid"))
    : Either.right(Object.freeze(contents.right.payload.entries.map((entry) => entry.entryId)));
}

function sourceTrace(
  location: SourceLoc,
  localFiles: ReadonlyMap<CanonicalSourcePathV1, string>,
  lookup: SourceManifestLookup,
): AssertionSourceTraceV1 | undefined {
  const runtimeFrames = sourceFrames(location);
  const projectIndexes = runtimeFrames
    .map((frame, index) => frame.kind === "project" ? index : -1)
    .filter((index) => index >= 0);
  const first = projectIndexes[0];
  const last = projectIndexes.at(-1);
  if (first === undefined || last === undefined) return undefined;

  const durableFrames: AssertionSourceFrameV1[] = [];
  for (const frame of runtimeFrames.slice(first, last + 1)) {
    if (frame.kind === "package") {
      const packageItemId = lookup.packages.get(frame.package);
      if (packageItemId === undefined) return undefined;
      durableFrames.push(Object.freeze({ target: Object.freeze({ kind: "package" as const, packageItemId }) }));
      continue;
    }
    const path = canonicalPath(frame.file);
    if (path === undefined) return undefined;
    const local = localFiles.get(stableFileKey(path));
    const sourceFile = lookup.files.get(stableFileKey(path));
    if (local === undefined || sourceFile === undefined || sourceFile.text !== local) return undefined;
    const coordinate = coordinateFor(local, frame.line, frame.column);
    if (coordinate === undefined) return undefined;
    durableFrames.push(Object.freeze({
      target: Object.freeze({
        kind: "file" as const,
        packageItemId: sourceFile.packageItemId,
        fileItemId: sourceFile.fileItemId,
        sha256: sourceFile.sha256,
      }),
      coordinate,
    }));
  }
  const firstFrame = durableFrames[0];
  const lastFrame = durableFrames.at(-1);
  if (!isSourceFileFrame(firstFrame) || !isSourceFileFrame(lastFrame)) return undefined;
  if (durableFrames.length === 1) {
    const singleFrame: [AssertionSourceFileFrameV1] = [firstFrame];
    return Object.freeze({ frames: Object.freeze(singleFrame) });
  }
  const middle = durableFrames.slice(1, -1);
  const traceFrames: [
    AssertionSourceFileFrameV1,
    ...AssertionSourceFrameV1[],
    AssertionSourceFileFrameV1,
  ] = [firstFrame, ...middle, lastFrame];
  return Object.freeze({ frames: Object.freeze(traceFrames) });
}

function isSourceFileFrame(
  frame: AssertionSourceFrameV1 | undefined,
): frame is AssertionSourceFileFrameV1 {
  return frame?.target.kind === "file";
}

function traceKey(trace: AssertionSourceTraceV1): string {
  return JSON.stringify(trace);
}

function nonEmpty<Value>(
  values: readonly Value[],
): readonly [Value, ...Value[]] | undefined {
  const first = values[0];
  if (first === undefined) return undefined;
  const tuple: [Value, ...Value[]] = [first, ...values.slice(1)];
  return Object.freeze(tuple);
}

function jointValid(
  sources: SourcesDocumentV1<RecordBlobRef>,
  sites: AssertionSourceSitesDocumentV1,
): boolean {
  const packages = new Set<string>();
  const files = new Map<string, string>();
  for (const sourcePackage of sources.packages) {
    packages.add(sourcePackage.packageItemId);
    for (const file of sourcePackage.files) {
      files.set(`${sourcePackage.packageItemId}\u0000${file.fileItemId}`, file.sha256);
    }
  }
  const validTrace = (trace: AssertionSourceTraceV1): boolean => trace.frames.every((frame) =>
    frame.target.kind === "package"
      ? packages.has(frame.target.packageItemId)
      : files.get(`${frame.target.packageItemId}\u0000${frame.target.fileItemId}`) === frame.target.sha256,
  );
  return sites.entries.every((entry) => entry.sites.every((site) => validTrace(site.trace)))
    && sites.sendSites.every((site) => validTrace(site.trace));
}

/**
 * Builds one Run Sources closure plus one source-sites write per fresh origin.
 * It accepts only snapshots already retained by the Attempt; it never opens a
 * current source file or any legacy graph/store/evidence surface.
 */
export function createRunnerSourceWritePlan(
  origins: readonly RunnerSourceOriginInput[],
): Either.Either<RunnerSourceWritePlan | undefined, RunnerSourceProducerInvalid> {
  if (origins.length === 0) return Either.right(undefined);

  const packageLabels = new Set<string>(["project"]);
  const textsByPath = new Map<CanonicalSourcePathV1, string>();
  const localBySlot = new Map<SlotId, ReadonlyMap<CanonicalSourcePathV1, string>>();

  for (const origin of origins) {
    const local = new Map<CanonicalSourcePathV1, string>();
    for (const artifact of origin.result.sources ?? []) {
      const snapshot = sourceSnapshot(artifact);
      if (snapshot === undefined) continue;
      const key = stableFileKey(snapshot.path);
      if (!local.has(key)) local.set(key, snapshot.text);
      if (!textsByPath.has(key)) textsByPath.set(key, snapshot.text);
    }
    const capture = sourceCaptureForResult(origin.result);
    for (const entry of capture?.entries ?? []) {
      for (const occurrence of entry.occurrences) {
        for (const frame of occurrence.site === undefined ? [] : sourceFrames(occurrence.site.location)) {
          if (frame.kind === "package") packageLabels.add(frame.package);
        }
      }
    }
    for (const send of capture?.sends ?? []) {
      for (const frame of send.site === undefined ? [] : sourceFrames(send.site.location)) {
        if (frame.kind === "package") packageLabels.add(frame.package);
      }
    }
    localBySlot.set(origin.slotId, local);
  }

  const packageInputs = [...packageLabels]
    .sort((left, right) => left.localeCompare(right))
    .map((label) => ({
      packageItemId: packageId(),
      label,
      files: label === "project"
        ? [...textsByPath.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([path, text]) => ({ fileItemId: fileId(), path, text }))
        : [],
    }));
  const sourcesWrite = createSourcesAttachmentWriteV1({ packages: packageInputs });
  if (Either.isLeft(sourcesWrite)) return Either.left(invalid("sources-write-invalid"));
  const sourceContents = recordAttachmentWriteContents<
    "run",
    SourcesDocumentV1<RecordBlobRef>,
    never,
    never
  >(sourcesWrite.right);
  if (Either.isLeft(sourceContents)) return Either.left(invalid("sources-closure-invalid"));

  const lookup = manifestLookup(sourceContents.right.payload);
  // Retain the exact persisted canonical bytes beside the immutable manifest
  // refs. This is producer-only validation state, never an extra Record value.
  for (const [path, text] of textsByPath) {
    const file = lookup.files.get(path);
    if (file !== undefined) {
      lookup.files.set(path, Object.freeze({ ...file, text }));
    }
  }

  const attemptWrites = new Map<SlotId, RecordAttachmentWrite<"attempt", never, never>>();
  for (const origin of origins) {
    const entryIds = assertionEntryIds(origin.assertions);
    if (Either.isLeft(entryIds)) return Either.left(entryIds.left);
    const capture = sourceCaptureForResult(origin.result);
    const localFiles = localBySlot.get(origin.slotId) ?? new Map<CanonicalSourcePathV1, string>();
    const entries: AssertionSourceSitesEntryV1[] = [];
    if (capture !== undefined && capture.entries.length === entryIds.right.length) {
      for (const [index, entryCapture] of capture.entries.entries()) {
        const entryId = entryIds.right[index];
        if (entryId === undefined) continue;
        const byTrace = new Map<string, {
          readonly trace: AssertionSourceTraceV1;
          readonly occurrences: AssertionSourceOccurrenceV1[];
        }>();
        for (const occurrence of entryCapture.occurrences) {
          if (occurrence.site === undefined) continue;
          if (occurrence.role === "stop" && occurrence.outcome === undefined) continue;
          const trace = sourceTrace(occurrence.site.location, localFiles, lookup);
          if (trace === undefined) continue;
          let next: AssertionSourceOccurrenceV1;
          if (occurrence.role === "stop") {
            const { outcome } = occurrence;
            if (outcome === undefined) continue;
            next = Object.freeze({
              sourceOrder: occurrence.site.sourceOrder,
              role: "stop" as const,
              outcome,
            });
          } else {
            next = Object.freeze({ sourceOrder: occurrence.site.sourceOrder, role: occurrence.role });
          }
          const key = traceKey(trace);
          const site = byTrace.get(key) ?? { trace, occurrences: [] };
          site.occurrences.push(next);
          byTrace.set(key, site);
        }
        const sites: AssertionSourceSiteV1[] = [];
        for (const site of [...byTrace.values()].sort((left, right) => {
          const [leftFirst] = left.occurrences;
          const [rightFirst] = right.occurrences;
          return (leftFirst?.sourceOrder ?? 0) - (rightFirst?.sourceOrder ?? 0);
        })) {
          const occurrences = nonEmpty(site.occurrences);
          if (occurrences !== undefined) {
            sites.push(Object.freeze({ trace: site.trace, occurrences }));
          }
        }
        const entrySites = nonEmpty(sites);
        if (entrySites !== undefined) {
          entries.push(Object.freeze({ entryId, sites: entrySites }));
        }
      }
    }

    const byTrace = new Map<string, {
      readonly trace: AssertionSourceTraceV1;
      readonly occurrences: AssertionSourceSendOccurrenceV1[];
    }>();
    for (const send of capture?.sends ?? []) {
      if (send.site === undefined || send.terminal === undefined || send.ambiguous === true) continue;
      const trace = sourceTrace(send.site.location, localFiles, lookup);
      if (trace === undefined) continue;
      const key = traceKey(trace);
      const site = byTrace.get(key) ?? { trace, occurrences: [] };
      site.occurrences.push(Object.freeze({
        sourceOrder: send.site.sourceOrder,
        label: send.terminal.label,
        status: send.terminal.status,
        durationMs: send.terminal.durationMs,
      }));
      byTrace.set(key, site);
    }
    const sendSites: AssertionSourceSendSiteV1[] = [];
    for (const site of [...byTrace.values()].sort((left, right) => {
      const [leftFirst] = left.occurrences;
      const [rightFirst] = right.occurrences;
      return (leftFirst?.sourceOrder ?? 0) - (rightFirst?.sourceOrder ?? 0);
    })) {
      const occurrences = nonEmpty(site.occurrences);
      if (occurrences !== undefined) {
        sendSites.push(Object.freeze({ trace: site.trace, occurrences }));
      }
    }
    const document: AssertionSourceSitesDocumentV1 = Object.freeze({
      entries: Object.freeze(entries),
      sendSites: Object.freeze(sendSites),
    });
    if (!jointValid(sourceContents.right.payload, document)) {
      return Either.left(invalid("source-sites-join-invalid"));
    }
    const write = createAssertionSourceSitesAttachmentWriteV1(document);
    if (Either.isLeft(write)) return Either.left(invalid("source-sites-write-invalid"));
    const contents = recordAttachmentWriteContents(write.right);
    if (Either.isLeft(contents)) return Either.left(invalid("source-sites-closure-invalid"));
    attemptWrites.set(origin.slotId, write.right);
  }

  return Either.right(Object.freeze({
    runWrite: sourcesWrite.right,
    attemptWrites: new Map(attemptWrites),
  }));
}
