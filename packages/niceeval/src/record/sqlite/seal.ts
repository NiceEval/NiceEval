import { createHash } from "node:crypto";
import type {
  PersistedAttachmentReference,
  PersistedCollectionItem,
  PersistedContentMetadata,
  PersistedMember,
  PersistedSlot,
  SealEntry,
} from "./types.ts";

const MAXIMUM_IDENTITY_CODE_UNITS = 16_384;
const encoder = new TextEncoder();

function lengthPrefix(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff) {
    throw new RangeError("canonical tuple component length is outside the supported range");
  }
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, length, false);
  return prefix;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

/** Rejects identities whose UTF-8 encoding would be lossy or unreasonably large. */
export function assertCanonicalIdentity(value: string, field: string): void {
  if (value.length === 0) throw new TypeError(`${field} is empty`);
  if (value.length > MAXIMUM_IDENTITY_CODE_UNITS) throw new TypeError(`${field} exceeds the identity ceiling`);
  if (hasUnpairedSurrogate(value)) throw new TypeError(`${field} contains an unpaired UTF-16 surrogate`);
}

export function compareCanonicalCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type TuplePart = string | number | Uint8Array | null;

function updatePart(hash: ReturnType<typeof createHash>, part: TuplePart): void {
  let tag: number;
  let payload: Uint8Array;
  if (typeof part === "string") {
    assertCanonicalIdentity(part, "canonical tuple string");
    tag = 1;
    payload = encoder.encode(part);
  } else if (typeof part === "number") {
    if (!Number.isSafeInteger(part)) throw new TypeError("canonical tuple number is not a safe integer");
    tag = 2;
    payload = encoder.encode(String(part));
  } else if (part === null) {
    tag = 3;
    payload = new Uint8Array(0);
  } else {
    tag = 4;
    payload = part;
  }
  hash.update(Uint8Array.of(tag));
  hash.update(lengthPrefix(payload.byteLength));
  hash.update(payload);
}

/** Domain-separated, type-tagged, length-prefixed tuple hash. */
export function hashCanonicalTuple(domain: string, parts: readonly TuplePart[]): string {
  const hash = createHash("sha256");
  updatePart(hash, domain);
  for (const part of parts) updatePart(hash, part);
  return hash.digest("hex");
}

/** Durable Record identities keep both their domain and canonical tuple order here. */
export function attachmentId(input: {
  readonly runId: string;
  readonly owner: import("../model/core.ts").RecordAttachmentOwner;
  readonly attemptId?: string;
  readonly family: string;
}): string {
  return hashCanonicalTuple("niceeval.record.attachment-id/v1", [
    input.runId,
    input.owner,
    input.owner === "attempt" ? input.attemptId ?? null : null,
    input.family,
  ]);
}

export function contentId(attachment: string, logicalHandle: string): string {
  return hashCanonicalTuple("niceeval.record.content-id/v1", [attachment, logicalHandle]);
}

export function attachmentLogicalIdentity(attachment: string, canonicalDigest: string, inventoryDigest: string): string {
  return hashCanonicalTuple("niceeval.record.attachment-logical-identity/v1", [attachment, canonicalDigest, inventoryDigest]);
}

export function collectionItemLogicalIdentity(ordinal: number, canonicalDigest: string): string {
  return hashCanonicalTuple("niceeval.record.collection-item-logical-identity/v1", [ordinal, canonicalDigest]);
}

function entry(kind: SealEntry["kind"], identity: readonly TuplePart[], closure: readonly TuplePart[]): SealEntry {
  return Object.freeze({
    kind,
    logicalIdentity: hashCanonicalTuple(`niceeval.record.seal.${kind}.identity/v1`, identity),
    digest: hashCanonicalTuple(`niceeval.record.seal.${kind}.closure/v1`, closure),
  });
}

export const recordSealEntry = (recordDigest: string): SealEntry =>
  entry("record", ["record"], [recordDigest]);

export const runSealEntry = (input: {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly coreDigest: string;
}): SealEntry => entry("run", [input.runId], [input.writerGeneration, input.startedAt, input.coreDigest]);

export const slotSealEntry = (runId: string, slot: Pick<PersistedSlot, "slotId" | "ordinal" | "coreDigest">): SealEntry =>
  entry("slot", [runId, slot.slotId], [slot.ordinal, slot.coreDigest]);

export const attemptSealEntry = (runId: string, attemptId: string, attemptLocator: string, coreDigest: string): SealEntry =>
  entry("attempt", [runId, attemptId], [attemptLocator, coreDigest]);

export const memberSealEntry = (runId: string, member: Pick<PersistedMember, "slotId" | "originRunId" | "attemptId" | "action" | "coreDigest">): SealEntry =>
  entry("member", [runId, member.slotId], [member.originRunId ?? null, member.attemptId ?? null, member.action, member.coreDigest]);

export const attachmentSealEntry = (input: {
  readonly attachmentId: string;
  readonly ownerKind: import("../model/core.ts").RecordAttachmentOwner;
  readonly ownerRunId: string;
  readonly ownerAttemptId?: string;
  readonly family: string;
  readonly familyRevision: number;
  readonly logicalIdentity: string;
  readonly canonicalDigest: string;
  readonly inventoryDigest: string;
}): SealEntry => entry("attachment", [input.attachmentId], [
  input.ownerKind,
  input.ownerRunId,
  input.ownerAttemptId ?? null,
  input.family,
  input.familyRevision,
  input.logicalIdentity,
  input.canonicalDigest,
  input.inventoryDigest,
]);

export const referenceSealEntry = (
  attachmentId: string,
  reference: Pick<PersistedAttachmentReference, "ordinal" | "owner" | "family" | "referenceDigest">,
): SealEntry => entry("attachment-reference", [attachmentId, reference.ordinal], [
  reference.owner,
  reference.family,
  reference.referenceDigest,
]);

export const collectionItemSealEntry = (
  attachmentId: string,
  item: Pick<PersistedCollectionItem, "ordinal" | "logicalIdentity" | "canonicalDigest">,
): SealEntry => entry("collection-item", [attachmentId, item.ordinal], [item.logicalIdentity, item.canonicalDigest]);

export const contentSealEntry = (
  attachmentId: string,
  content: PersistedContentMetadata,
): SealEntry => entry("content", [content.contentId], [
  attachmentId,
  content.logicalHandle,
  content.byteLength,
  content.digest,
  content.chunkCount,
]);

export const contentChunkSealEntry = (contentId: string, ordinal: number, chunkDigest: string): SealEntry =>
  entry("content-chunk", [contentId, ordinal], [chunkDigest]);

export function orderSealEntries(entries: readonly SealEntry[]): readonly SealEntry[] {
  return [...entries].sort((left, right) =>
    compareCanonicalCodeUnits(left.kind, right.kind) ||
    compareCanonicalCodeUnits(left.logicalIdentity, right.logicalIdentity) ||
    compareCanonicalCodeUnits(left.digest, right.digest));
}

export function exactLogicalSealIdentity(entries: readonly SealEntry[]): string {
  const ordered = orderSealEntries(entries);
  return exactLogicalSealIdentityFromOrdered(ordered, ordered.length);
}

/** Hashes an already canonically ordered iterator without materializing it. */
export function exactLogicalSealIdentityFromOrdered(entries: Iterable<SealEntry>, count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("logical Seal entry count is invalid");
  const hash = createHash("sha256");
  updatePart(hash, "niceeval.record.logical-seal/v1");
  updatePart(hash, count);
  let observed = 0;
  for (const value of entries) {
    updatePart(hash, value.kind);
    updatePart(hash, value.logicalIdentity);
    updatePart(hash, value.digest);
    observed += 1;
  }
  if (observed !== count) throw new TypeError("logical Seal ordered iterator count changed");
  return hash.digest("hex");
}
