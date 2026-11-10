// @concord-file
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/inspection/architecture.md
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
import { Result, Schema } from "effect";
import { attachmentValueContents, readAttachmentPayload } from "../record/sqlite/attachment-payload.ts";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import {
  mintRecordContentHandle,
  type RecordContentHandle,
} from "../record/attachment/content.ts";
import {
  enumerateRecordAttachmentClosure,
  hydrateRecordAttachmentCurrent,
  mintRecordAttachmentReference,
  RecordAttachmentReference,
  recordAttachmentReferenceWire,
} from "../record/attachment/protocol.ts";
import {
  decodeAttemptDocument,
  decodeMemberDocument,
  decodeRunDocument,
  RecordExactParseOptions,
  RecordSlotIdentitySchema,
} from "../record/codec/core.ts";
import {
  NiceEvalCurrentRecordAttachments,
  NiceEvalRecordAttachments,
} from "../record/family/current.ts";
import type { AssertionsAttachment } from "../record/family/assertions/definition.ts";
import type {
  AttemptDocument,
  MemberDocument,
  RunDocument,
} from "../record/model/core.ts";
import type {
  PersistedContentMetadata,
  SealedAttachmentMetadata,
  SealedRunCore,
  SealedRunSummary,
} from "../record/sqlite/types.ts";
import {
  closeInspectionJson,
  isInspectionCodecError,
  type InspectionJson,
} from "./codec.ts";
import type { InspectionFactSource } from "./source.ts";
import { InspectionSha256 } from "./bytes.ts";
import type { ReadableRunResource } from "../run/storage/types.ts";

export interface DecodedInspectionAttachment {
  readonly physical: SealedAttachmentMetadata;
  readonly value: InspectionJson;
}

/** A strictly decoded sealed Run with its browser-neutral reader capability. */
export interface LoadedInspectionRun {
  readonly source: InspectionFactSource;
  readonly physical: SealedRunCore;
  readonly run: RunDocument;
  readonly members: readonly MemberDocument[];
  readonly attempts: readonly AttemptDocument[];
  readonly attachments: readonly DecodedInspectionAttachment[];
}

/** Exact lifecycle resource plus its optional published Core at one cutoff. */
export interface LoadedInspectionRunResource {
  readonly source: InspectionFactSource;
  readonly resource: ReadableRunResource;
  readonly members: readonly MemberDocument[];
  readonly supporting: readonly LoadedInspectionRun[];
  readonly published?: LoadedInspectionRun;
}

export interface InspectionAttemptTarget {
  readonly run: LoadedInspectionRun;
  readonly member: MemberDocument;
}

/** Exact origin Attempt plus every target membership visible to the resolver. */
export interface ResolvedInspectionAttempt {
  readonly attempt: AttemptDocument;
  readonly origin: LoadedInspectionRun;
  readonly locator: string;
  readonly targets: readonly InspectionAttemptTarget[];
}

export type InspectionAssertionsRead =
  | {
      readonly state: "available";
      readonly attachment: DecodedInspectionAttachment;
      readonly value: AssertionsAttachment;
      readonly contents: WeakMap<object, PersistedContentMetadata>;
      readonly issues: readonly InspectionJson[];
    }
  | {
      readonly state: "not-recorded" | "unsupported" | "failed";
      readonly attachment?: DecodedInspectionAttachment;
      readonly issues: readonly InspectionJson[];
    };

const RUN_PAGE_SIZE = 100;
const ATTEMPT_CANDIDATE_RUN_LIMIT = 64;
const ATTEMPT_TARGET_MEMBER_LIMIT = 256;
const decodedRuns = new WeakMap<InspectionFactSource, Map<string, LoadedInspectionRun>>();

function readInspectionRun(source: InspectionFactSource, runId: string): LoadedInspectionRun | undefined {
  let cache = decodedRuns.get(source);
  if (cache === undefined) decodedRuns.set(source, cache = new Map());
  const cached = cache.get(runId);
  if (cached !== undefined) return cached;
  const physical = source.readSealedRunCore(runId);
  if (physical === undefined) return undefined;
  const decoded = decodeInspectionRun(source, physical);
  cache.set(runId, decoded);
  return decoded;
}

/**
 * Pins the source cutoff, exhausts the fixed Run-summary pagination, then
 * reads and strictly decodes every Run Core in that exact sealed generation.
 */
// @concord-code
// @concord-implements docs/feature/inspection/architecture.md
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
export function loadInspectionRuns(
  source: InspectionFactSource,
): readonly LoadedInspectionRun[] {
  const cutoff = source.cutoff();
  const summaries: SealedRunSummary[] = [];
  const seen = new Set<string>();
  let expectedRunCount: number | undefined;
  let afterRunId = "";

  for (;;) {
    const page = source.readSealedRunSummaryPage(
      afterRunId,
      RUN_PAGE_SIZE,
      cutoff.identity,
    );
    if (page.cutoff.identity !== cutoff.identity ||
        expectedRunCount !== undefined && page.cutoff.runCount !== expectedRunCount) {
      throw factsError("Run inventory changed its pinned cutoff or count");
    }
    expectedRunCount ??= page.cutoff.runCount;
    if (page.afterRunId !== afterRunId) {
      throw factsError("Run pagination returned a different cursor");
    }
    let previous = afterRunId;
    for (const summary of page.summaries) {
      if (summary.runId <= previous || seen.has(summary.runId)) {
        throw factsError("Run pagination is not strictly ordered");
      }
      seen.add(summary.runId);
      summaries.push(summary);
      previous = summary.runId;
    }
    if (page.nextAfterRunId === null) break;
    if (
      page.summaries.length === 0 ||
      page.nextAfterRunId !== page.summaries.at(-1)!.runId ||
      page.nextAfterRunId === afterRunId
    ) {
      throw factsError("Run pagination returned an invalid continuation cursor");
    }
    afterRunId = page.nextAfterRunId;
  }

  if (summaries.length !== expectedRunCount) {
    throw factsError("Run pagination did not close the pinned sealed cutoff");
  }
  return Object.freeze(summaries.map((summary) => {
    const run = readInspectionRun(source, summary.runId);
    if (run === undefined) {
      throw factsError(`Sealed Run ${summary.runId} disappeared from the pinned cutoff`);
    }
    return run;
  }));
}

/** Reads a bounded, explicit Run selection without changing its caller order. */
export function loadSelectedInspectionRuns(
  source: InspectionFactSource,
  runIds: readonly string[],
): readonly LoadedInspectionRun[] {
  const cutoff = source.cutoff();
  const loaded: LoadedInspectionRun[] = [];
  for (const runId of new Set(runIds)) {
    const run = readInspectionRun(source, runId);
    if (run !== undefined) loaded.push(run);
  }
  requireCutoff(source.cutoff(), cutoff);
  return Object.freeze(loaded);
}

/** Reads Run create/close facts even when no Attempt Core has been published. */
export function loadInspectionRunResource(
  source: InspectionFactSource,
  runId: string,
): LoadedInspectionRunResource | undefined {
  const cutoff = source.cutoff();
  const resource = source.readRunResource(runId);
  if (resource === undefined) return undefined;
  const published = readInspectionRun(source, runId);
  if (published !== undefined) validateRunResourceCore(resource, published);
  const originIds = resource.slots.flatMap(({ publication }) =>
    publication.state === "published" ? [publication.originRunId] : []);
  const supporting = loadSelectedInspectionRuns(source, [
    ...(published === undefined ? [] : [runId]), ...originIds,
  ]);
  const index = memberIndex(supporting);
  const publications = new Map<string, SealedRunCore["attempts"][number]>(supporting.flatMap((origin) =>
    origin.physical.attempts.map((attempt) => [
      `${origin.run.runId}\u0000${attempt.attemptId}`, attempt,
    ] as const)));
  const members = resource.slots.flatMap(({ slotId, publication }): readonly MemberDocument[] => {
    if (publication.state === "pending") return [];
    if (publication.state === "absent") {
      return [decodedRight(decodeMemberDocument({
        slotId,
        action: publication.reason === "interrupted-before-publication" || publication.reason === "dispatch-failed"
          ? "interrupted" : "not-dispatched",
        attempt: null,
        absenceReason: publication.reason,
      }), "Run resource absence is invalid")];
    }
    const origin = index.origins.get(publication.originRunId);
    const attempt = origin?.attempts.get(publication.attemptId);
    const stored = publications.get(`${publication.originRunId}\u0000${publication.attemptId}`);
    if (attempt === undefined || stored === undefined ||
        attempt.slotId !== publication.originSlotId ||
        stored.attemptLocator !== publication.attemptLocator ||
        stored.publicationIdentity?.originRunId !== publication.publicationIdentity.originRunId ||
        stored.publicationIdentity?.attemptId !== publication.publicationIdentity.attemptId ||
        stored.publicationIdentity?.revision !== publication.publicationIdentity.revision ||
        publication.publicationIdentity.originRunId !== publication.originRunId ||
        publication.publicationIdentity.attemptId !== publication.attemptId ||
        publication.action === "executed" && publication.originRunId !== runId) {
      throw factsError(`Run ${runId} Slot ${slotId} does not bind a matching published origin Attempt`);
    }
    return [decodedRight(decodeMemberDocument({
      slotId, action: publication.action,
      attempt: { originRunId: publication.originRunId, attemptId: publication.attemptId },
    }), "Run resource binding is invalid")];
  }).sort((left, right) => compareText(left.slotId, right.slotId));
  requireCutoff(source.cutoff(), cutoff);
  return Object.freeze({
    source, resource, members: Object.freeze(members), supporting,
    ...(published === undefined ? {} : { published }),
  });
}

function validateRunResourceCore(
  resource: ReadableRunResource,
  published: LoadedInspectionRun,
): void {
  const run = published.run;
  if (
    run.runId !== resource.runId ||
    run.experimentId !== resource.experimentId ||
    run.startedAt !== Date.parse(resource.startedAt) ||
    run.expectedSlots.length !== resource.slots.length
  ) {
    throw factsError(`Run ${resource.runId} lifecycle resource does not match its published Core`);
  }
  for (const [index, slot] of run.expectedSlots.entries()) {
    const expected = resource.slots[index];
    if (
      expected === undefined ||
      slot.slotId !== expected.slotId ||
      slot.evalId !== expected.evalId ||
      slot.attemptOrdinal !== expected.attemptOrdinal ||
      slot.executionIdentityDigest !== expected.executionIdentityDigest
    ) {
      throw factsError(`Run ${resource.runId} expected Slot does not match its published Core`);
    }
  }
}

/** Strictly decodes Core, then decodes each Attachment only on first use. */
export function decodeInspectionRun(
  source: InspectionFactSource,
  physical: SealedRunCore,
): LoadedInspectionRun {
  const run = decodedRight(
    decodeRunDocument(parseVerifiedJson(physical.runCoreBytes, physical.runCoreDigest, "Run Core")),
    "Run Core is invalid",
  );
  if (run.runId !== physical.runId) {
    throw factsError("Run Core identity does not match its sealed row");
  }

  if (physical.slots.length !== run.expectedSlots.length) {
    throw factsError("Run Core Slot rows do not match its expected denominator");
  }
  for (const [index, stored] of physical.slots.entries()) {
    const decoded = Schema.decodeUnknownResult(
      RecordSlotIdentitySchema,
      RecordExactParseOptions,
    )(parseVerifiedJson(stored.coreBytes, stored.coreDigest, "Slot Core"));
    const slot = decodedRight(decoded, "Slot Core is invalid");
    const expected = run.expectedSlots[index];
    if (
      expected === undefined ||
      stored.ordinal !== index ||
      stored.slotId !== slot.slotId ||
      slot.slotId !== expected.slotId ||
      slot.evalId !== expected.evalId ||
      slot.attemptOrdinal !== expected.attemptOrdinal ||
      slot.executionIdentityDigest !== expected.executionIdentityDigest
    ) {
      throw factsError("Slot Core does not match its sealed Run denominator");
    }
  }

  const members = physical.members.map((stored) => {
    const member = decodedRight(
      decodeMemberDocument(parseVerifiedJson(stored.coreBytes, stored.coreDigest, "Member Core")),
      "Member Core is invalid",
    );
    if (
      member.slotId !== stored.slotId ||
      member.action !== stored.action ||
      (member.attempt?.originRunId ?? undefined) !== stored.originRunId ||
      (member.attempt?.attemptId ?? undefined) !== stored.attemptId
    ) {
      throw factsError("Member Core does not match its sealed row");
    }
    return member;
  });
  const attempts = physical.attempts.map((stored) => {
    const attempt = decodedRight(
      decodeAttemptDocument(parseVerifiedJson(stored.coreBytes, stored.coreDigest, "Attempt Core")),
      "Attempt Core is invalid",
    );
    if (
      attempt.attemptId !== stored.attemptId ||
      attempt.originRunId !== run.runId ||
      encodeAttemptLocator(attempt.attemptId) !== stored.attemptLocator
    ) {
      throw factsError("Attempt Core does not match its sealed row");
    }
    return attempt;
  });
  validateCoreRelations(run, members, attempts, physical.publicationManaged === true);

  const localAttemptIds = new Set<string>(
    attempts.map(({ attemptId }) => attemptId),
  );
  const attachments = physical.attachments.map((attachment): DecodedInspectionAttachment => {
    if (
      attachment.ownerRunId !== run.runId ||
      attachment.ownerKind === "run" && attachment.ownerAttemptId !== undefined ||
      attachment.ownerKind === "attempt" &&
        (attachment.ownerAttemptId === undefined ||
          !localAttemptIds.has(attachment.ownerAttemptId))
    ) {
      throw factsError("Attachment ownership does not match its sealed Run");
    }
    let value: InspectionJson | undefined;
    let decoded = false;
    return Object.freeze({
      physical: Object.freeze(Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(attachment),
        contents: { enumerable: true, get: () => attachmentValueContents(attachment) },
      })) as typeof attachment,
      get value(): InspectionJson {
        if (!decoded) {
          verifyDigest(attachment.canonicalBytes, attachment.canonicalDigest, "Attachment");
          verifyDigest(attachment.logicalInventoryBytes, attachment.inventoryDigest, "Attachment inventory");
          value = parseInspectionJson(readAttachmentPayload(attachment, source.readContentPage), "Attachment");
          decoded = true;
        }
        return value!;
      },
    });
  });

  return Object.freeze({
    source,
    physical,
    run,
    members: Object.freeze(members),
    attempts: Object.freeze(attempts),
    attachments: Object.freeze(attachments),
  });
}

/** Resolves a public locator through the source's bounded exact index. */
// @concord-code
// @concord-implements docs/feature/inspection/architecture.md
export function resolveInspectionAttempt(
  source: InspectionFactSource,
  locator: string,
): ResolvedInspectionAttempt | undefined {
  const projection = source.findAttemptLocatorCandidates(
    locator,
    ATTEMPT_CANDIDATE_RUN_LIMIT,
  );
  if (projection.candidates.length === 0) return undefined;
  if (projection.ambiguous) return undefined;
  const origins = projection.candidates.filter(({ relation }) => relation === "origin");
  if (origins.length !== 1) {
    throw factsError(`Attempt ${locator} indexed projection is invalid`);
  }
  const identity = origins[0]!;
  const runs = loadSelectedInspectionRuns(
    source,
    projection.candidates.map(({ runId }) => runId),
  );
  const byRunId = new Map<string, LoadedInspectionRun>(
    runs.map((run) => [run.run.runId, run] as const),
  );
  const origin = byRunId.get(identity.originRunId);
  if (origin === undefined) {
    throw factsError(`Attempt ${locator} origin is not a sealed Run`);
  }
  const attempt = origin.attempts.find((candidate) =>
    candidate.attemptId === identity.attemptId &&
    candidate.originRunId === identity.originRunId &&
    encodeAttemptLocator(candidate.attemptId) === locator);
  if (attempt === undefined) {
    throw factsError(`Attempt ${locator} origin Core is invalid`);
  }

  const targets: InspectionAttemptTarget[] = [];
  const targetRunIds = new Set(projection.candidates.flatMap((candidate) =>
    candidate.relation === "target" &&
      candidate.originRunId === identity.originRunId &&
      candidate.attemptId === identity.attemptId
      ? [candidate.runId]
      : []));
  for (const runId of targetRunIds) {
    const run = byRunId.get(runId);
    if (run === undefined) {
      throw factsError(`Attempt ${locator} target is not a sealed Run`);
    }
    const members = targetMembers(run, attempt);
    if (members.length === 0) {
      throw factsError(`Attempt ${locator} target Core is invalid`);
    }
    if (targets.length + members.length > ATTEMPT_TARGET_MEMBER_LIMIT) {
      throw factsError(`Attempt ${locator} exceeds its fixed target member limit`);
    }
    targets.push(...members.map((member) => Object.freeze({ run, member })));
  }
  return Object.freeze({
    attempt,
    origin,
    locator,
    targets: Object.freeze(targets),
  });
}

interface InspectionMemberIndex {
  readonly origins: ReadonlyMap<string, { readonly run: LoadedInspectionRun; readonly attempts: ReadonlyMap<string, AttemptDocument>; readonly members: ReadonlyMap<string, MemberDocument> }>;
  readonly targets: ReadonlyMap<string, ReadonlyMap<string, readonly InspectionAttemptTarget[]>>;
}
const memberIndexes = new WeakMap<readonly LoadedInspectionRun[], InspectionMemberIndex>();

function memberIndex(runs: readonly LoadedInspectionRun[]): InspectionMemberIndex {
  const cached = memberIndexes.get(runs);
  if (cached !== undefined) return cached;
  const origins = new Map(runs.map((run) => [run.run.runId, {
    run, attempts: new Map(run.attempts.map((attempt) => [attempt.attemptId, attempt])),
    members: new Map(run.members.map((member) => [member.slotId, member])),
  }]));
  const targets = new Map<string, Map<string, InspectionAttemptTarget[]>>();
  for (const run of runs) for (const member of run.members) {
    if (member.attempt === null) continue;
    const { originRunId, attemptId } = member.attempt;
    let byAttempt = targets.get(originRunId);
    if (byAttempt === undefined) targets.set(originRunId, byAttempt = new Map());
    let members = byAttempt.get(attemptId);
    if (members === undefined) byAttempt.set(attemptId, members = []);
    members.push(Object.freeze({ run, member }));
  }
  for (const byAttempt of targets.values()) for (const members of byAttempt.values()) Object.freeze(members);
  const index = { origins, targets };
  memberIndexes.set(runs, index);
  return index;
}

/** Resolves already loaded facts through one shared identity index. */
export function resolveInspectionMemberAttempt(
  runs: readonly LoadedInspectionRun[],
  target: LoadedInspectionRun,
  member: MemberDocument,
): ResolvedInspectionAttempt | undefined {
  if (member.attempt === null) return undefined;
  const index = memberIndex(runs);
  const origin = index.origins.get(member.attempt.originRunId);
  const attempt = origin?.attempts.get(member.attempt.attemptId);
  if (origin === undefined || attempt === undefined || attempt.originRunId !== member.attempt.originRunId) return undefined;
  const targets = index.targets.get(attempt.originRunId)?.get(attempt.attemptId) ?? [];
  const targetMember = index.origins.get(target.run.runId)?.members.get(member.slotId);
  if (targetMember?.attempt?.originRunId !== attempt.originRunId || targetMember.attempt.attemptId !== attempt.attemptId) return undefined;
  return Object.freeze({ attempt, origin: origin.run, locator: encodeAttemptLocator(attempt.attemptId), targets });
}

/** A target binding does not require the target to have published its own Run Core. */
export function resolveInspectionResourceMemberAttempt(
  target: LoadedInspectionRunResource,
  member: MemberDocument,
): ResolvedInspectionAttempt | undefined {
  if (member.attempt === null) return undefined;
  const index = memberIndex(target.supporting);
  const origin = index.origins.get(member.attempt.originRunId);
  const attempt = origin?.attempts.get(member.attempt.attemptId);
  if (origin === undefined || attempt === undefined) return undefined;
  const targets = index.targets.get(attempt.originRunId)?.get(attempt.attemptId) ?? [];
  return Object.freeze({ attempt, origin: origin.run, locator: encodeAttemptLocator(attempt.attemptId), targets });
}

export function attemptAttachment(
  resolved: ResolvedInspectionAttempt,
  family: string,
): DecodedInspectionAttachment | undefined {
  return resolved.origin.attachments.find(({ physical }) =>
    physical.ownerKind === "attempt" &&
    physical.ownerAttemptId === resolved.attempt.attemptId &&
    physical.family === family);
}

export function runAttachment(
  run: LoadedInspectionRun,
  family: string,
): DecodedInspectionAttachment | undefined {
  return run.attachments.find(({ physical }) =>
    physical.ownerKind === "run" && physical.family === family);
}

/** Reads only the current logical Assertions family, preserving failure state. */
// @concord-code
// @concord-implements docs/feature/assertions/README.md
// @concord-implements docs/feature/inspection/README.md
export function readInspectionAssertions(
  resolved: ResolvedInspectionAttempt,
): InspectionAssertionsRead {
  const attachment = attemptAttachment(
    resolved,
    NiceEvalRecordAttachments.assertions.family,
  );
  if (attachment === undefined) {
    return Object.freeze({
      state: "not-recorded" as const,
      issues: Object.freeze([issue("assertions-not-recorded", resolved.locator)]),
    });
  }
  if (
    attachment.physical.familyRevision !==
      NiceEvalCurrentRecordAttachments.assertions.revision
  ) {
    return Object.freeze({
      state: "unsupported" as const,
      attachment,
      issues: Object.freeze([issue("assertions-revision-unsupported", resolved.locator)]),
    });
  }
  const decoded = decodeCurrentAssertions(attachment);
  if (decoded === undefined) {
    return Object.freeze({
      state: "failed" as const,
      attachment,
      issues: Object.freeze([issue("assertions-current-invalid", resolved.locator)]),
    });
  }
  return Object.freeze({
    state: "available" as const,
    attachment,
    value: decoded.value,
    contents: decoded.contents,
    issues: Object.freeze([]),
  });
}

function decodeCurrentAssertions(
  attachment: DecodedInspectionAttachment,
): {
  readonly value: AssertionsAttachment;
  readonly contents: WeakMap<object, PersistedContentMetadata>;
} | undefined {
  const definition = NiceEvalRecordAttachments.assertions;
  const byHandle = new Map(
    attachment.physical.contents.map((content) => [content.logicalHandle, content]),
  );
  const handles = new Map<string, RecordContentHandle>();
  const contents = new WeakMap<object, PersistedContentMetadata>();
  const usedContent = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrent(definition, attachment.value, {
    content: (token, declaration) => {
      const logicalHandle = exactMarker(token, "$niceeval.record.content");
      if (
        logicalHandle === undefined &&
        !hasOwnMarker(token, "$niceeval.record.content")
      ) {
        return Result.succeed(undefined);
      }
      if (typeof logicalHandle !== "string") {
        return Result.fail({ code: "current-content-bind-failed" as const });
      }
      const metadata = byHandle.get(logicalHandle);
      if (
        metadata === undefined ||
        declaration.maximumBytes !== undefined &&
          metadata.byteLength > declaration.maximumBytes
      ) {
        return Result.fail({ code: "current-content-bind-failed" as const });
      }
      let handle = handles.get(logicalHandle);
      if (handle === undefined) {
        handle = mintRecordContentHandle(declaration.kind);
        handles.set(logicalHandle, handle);
        contents.set(handle, metadata);
      }
      usedContent.add(logicalHandle);
      return Result.succeed(handle);
    },
    reference: (token, declaration) => {
      const marker = exactMarker(token, "$niceeval.record.reference");
      if (
        marker === undefined &&
        !hasOwnMarker(token, "$niceeval.record.reference")
      ) {
        return Result.succeed(undefined);
      }
      if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
        return Result.fail({ code: "current-reference-bind-failed" as const });
      }
      const value = marker as Record<string, unknown>;
      if (
        Reflect.ownKeys(value).length !== 3 ||
        value.owner !== declaration.definition.owner ||
        value.family !== declaration.definition.family ||
        !("value" in value)
      ) {
        return Result.fail({ code: "current-reference-bind-failed" as const });
      }
      return Result.succeed(mintRecordAttachmentReference(
        RecordAttachmentReference.to(
          declaration.definition,
          declaration.valueSchema,
        ),
        value.value,
      ));
    },
  });
  if (
    Result.isFailure(hydrated) ||
    usedContent.size !== attachment.physical.contents.length
  ) {
    return undefined;
  }

  const closure = enumerateRecordAttachmentClosure(definition, hydrated.success);
  if (Result.isFailure(closure)) return undefined;
  const references = new Map<string, { readonly owner: string; readonly family: string }>();
  for (const reference of closure.success.references) {
    const wire = recordAttachmentReferenceWire(reference);
    if (wire === undefined) return undefined;
    references.set(
      `${wire.owner}\u0000${wire.family}`,
      Object.freeze({ owner: wire.owner, family: wire.family }),
    );
  }
  const ordered = [...references.values()].sort((left, right) =>
    compareText(left.owner, right.owner) || compareText(left.family, right.family));
  if (ordered.length !== attachment.physical.references.length) return undefined;
  for (let ordinal = 0; ordinal < ordered.length; ordinal += 1) {
    const logical = ordered[ordinal]!;
    const physical = attachment.physical.references[ordinal]!;
    if (
      physical.ordinal !== ordinal ||
      physical.owner !== logical.owner ||
      physical.family !== logical.family
    ) {
      return undefined;
    }
  }
  return Object.freeze({ value: hydrated.success, contents });
}

function validateCoreRelations(
  run: RunDocument,
  members: readonly MemberDocument[],
  attempts: readonly AttemptDocument[],
  allowPendingSlots = false,
): void {
  const slots = new Map(run.expectedSlots.map((slot) => [slot.slotId, slot] as const));
  if (slots.size !== run.expectedSlots.length || (!allowPendingSlots && members.length !== slots.size) || members.length > slots.size) {
    throw factsError("Run Core does not close its expected Slot membership");
  }
  const memberSlots = new Set<string>();
  for (const member of members) {
    if (!slots.has(member.slotId) || memberSlots.has(member.slotId)) {
      throw factsError("Run Core contains an invalid Member Slot");
    }
    memberSlots.add(member.slotId);
  }
  const attemptIds = new Set<string>();
  for (const attempt of attempts) {
    const slot = slots.get(attempt.slotId);
    if (
      attemptIds.has(attempt.attemptId) ||
      slot === undefined ||
      attempt.evalId !== slot.evalId ||
      attempt.executionIdentityDigest !== slot.executionIdentityDigest
    ) {
      throw factsError("Run Core contains an invalid origin Attempt");
    }
    attemptIds.add(attempt.attemptId);
  }
  for (const member of members) {
    if (
      member.action === "executed" &&
      (member.attempt === null ||
        member.attempt.originRunId !== run.runId ||
        !attemptIds.has(member.attempt.attemptId))
    ) {
      throw factsError("Executed Member does not name a local origin Attempt");
    }
  }
}

function targetMembers(
  run: LoadedInspectionRun,
  attempt: AttemptDocument,
): readonly MemberDocument[] {
  return run.members.filter((member) =>
    member.attempt !== null &&
    member.attempt.originRunId === attempt.originRunId &&
    member.attempt.attemptId === attempt.attemptId);
}

function requireCutoff(
  actual: ReturnType<InspectionFactSource["cutoff"]>,
  expected: ReturnType<InspectionFactSource["cutoff"]>,
): void {
  if (
    actual.storeGeneration !== expected.storeGeneration ||
    actual.revision !== expected.revision
  ) {
    throw factsError("Inspection source changed its pinned sealed cutoff");
  }
}

function parseJson(bytes: Uint8Array, owner: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (cause) {
    throw factsError(`${owner} is not canonical UTF-8 JSON`, cause);
  }
}

function parseInspectionJson(
  bytes: Uint8Array,
  owner: string,
): InspectionJson {
  const closed = closeInspectionJson(parseJson(bytes, owner));
  if (isInspectionCodecError(closed)) {
    throw factsError(`${owner} is invalid: ${closed.reason}`);
  }
  return closed;
}

function decodedRight<A>(
  decoded: Result.Result<A, unknown>,
  reason: string,
): A {
  if (Result.isFailure(decoded)) throw factsError(reason, decoded.failure);
  return decoded.success;
}

function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable === true && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function hasOwnMarker(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key);
}

function issue(code: string, locator: string): InspectionJson {
  return Object.freeze({ code, locator });
}

function factsError(reason: string, cause?: unknown): Error {
  return new Error(reason, cause === undefined ? undefined : { cause });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function verifyDigest(bytes: Uint8Array, digest: string, label: string): void {
  if (new InspectionSha256().update(bytes).digestHex() !== digest) throw factsError(`${label} digest is invalid`);
}

function parseVerifiedJson(bytes: Uint8Array, digest: string, label: string): unknown {
  verifyDigest(bytes, digest, label);
  return parseJson(bytes, label);
}
