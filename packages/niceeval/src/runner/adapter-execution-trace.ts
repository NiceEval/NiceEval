import { createHash, randomBytes } from "node:crypto";

import { Data, Result, Schema } from "effect";

import type {
  ExecutionTraceInput,
  ExecutionTraceReceipt,
  TraceJson,
} from "../adapter-execution-trace.ts";
import {
  canonicalizeRecordJson,
  canonicalRecordJsonText,
  type RecordJson,
} from "../record/definition/canonical.ts";
import {
  ExecutionTraceInputSchema,
  ExecutionTraceRecordLimits,
  type ExecutionTraceEventRecord,
  type ExecutionTraceHeaderRecord,
  type ExecutionTraceRecord,
} from "../record/family/execution-traces/schema.ts";
import { RECORD_SQLITE_MAX_ROW_BYTES } from "../record/sqlite/types.ts";
import type { EvalResult } from "./types.ts";
import type { CapturedAdapterAttachment } from "./adapter-attachments.ts";

export class AdapterExecutionTraceError extends Data.TaggedError("AdapterExecutionTraceError")<{
  readonly code:
    | "execution-trace-invalid"
    | "execution-trace-limit"
    | "execution-trace-conflict"
    | "execution-trace-evidence-missing"
    | "evidence-budget-exceeded"
    | "execution-trace-closed"
    | "execution-trace-failed";
  readonly message: string;
}> {}

export interface AcceptedExecutionTrace {
  readonly sourceTraceId: string;
  readonly canonicalInputDigest: string;
  readonly receipt: ExecutionTraceReceipt;
  readonly records: readonly ExecutionTraceRecord[];
}

export interface AdapterExecutionTraceSnapshot {
  readonly traces: readonly AcceptedExecutionTrace[];
  readonly failure: AdapterExecutionTraceError | undefined;
}

const captures = new WeakMap<EvalResult, AdapterExecutionTraceSnapshot>();

export function retainAdapterExecutionTraces(
  result: EvalResult,
  snapshot: AdapterExecutionTraceSnapshot,
): void {
  if (snapshot.traces.length > 0 || snapshot.failure !== undefined) captures.set(result, snapshot);
}

export function adapterExecutionTracesForResult(
  result: EvalResult,
): AdapterExecutionTraceSnapshot | undefined {
  return captures.get(result);
}

export interface AdapterExecutionTraceCollector {
  readonly recordTrace: <Event extends import("../adapter-execution-trace.ts").ExecutionTraceEvent>(
    input: ExecutionTraceInput<Event>,
  ) => Promise<ExecutionTraceReceipt>;
  readonly failure: () => AdapterExecutionTraceError | undefined;
  readonly close: () => void;
  readonly snapshot: () => AdapterExecutionTraceSnapshot;
}

const INPUT_LIMITS = Object.freeze({
  maximumJsonBytes: ExecutionTraceRecordLimits.maximumCanonicalInputBytes,
  maximumDepth: ExecutionTraceRecordLimits.maximumJsonDepth,
  maximumNodes: 40_000_000,
  maximumObjectKeys: 20_000_000,
  maximumArrayItems: 40_000_000,
  maximumKeyUtf8Bytes: ExecutionTraceRecordLimits.maximumCanonicalInputBytes,
  maximumStringUtf8Bytes: ExecutionTraceRecordLimits.maximumCanonicalInputBytes,
});

const TARGET_LIMITS = Object.freeze({
  maximumJsonBytes: ExecutionTraceRecordLimits.maximumEvidenceTargetBytes,
  maximumDepth: ExecutionTraceRecordLimits.maximumJsonDepth,
  maximumNodes: 70_000_000,
  maximumObjectKeys: 40_000_000,
  maximumArrayItems: 70_000_000,
  maximumKeyUtf8Bytes: ExecutionTraceRecordLimits.maximumEvidenceTargetBytes,
  maximumStringUtf8Bytes: ExecutionTraceRecordLimits.maximumEvidenceTargetBytes,
});

const PERSISTED_ITEM_LIMITS = Object.freeze({
  maximumJsonBytes: RECORD_SQLITE_MAX_ROW_BYTES,
  maximumDepth: 64,
  maximumNodes: 100_000,
  maximumObjectKeys: 10_000,
  maximumArrayItems: 100_000,
  maximumKeyUtf8Bytes: 16_384,
  maximumStringUtf8Bytes: RECORD_SQLITE_MAX_ROW_BYTES,
});

const exactDecode = Schema.decodeUnknownResult(ExecutionTraceInputSchema, {
  onExcessProperty: "error",
});
const utf8 = new TextEncoder();

interface VerifiedEvidenceTarget {
  readonly artifactSha256: string;
  readonly targetSha256: string;
  readonly targetByteLength: number;
}

function traceError(
  code: AdapterExecutionTraceError["code"],
  message: string,
): AdapterExecutionTraceError {
  return new AdapterExecutionTraceError({ code, message });
}

function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableId(prefix: "et" | "ee" | "ev"): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

function rejectSettled<T>(error: AdapterExecutionTraceError): Promise<T> {
  const rejected = Promise.reject<T>(error);
  void rejected.catch(() => undefined);
  return rejected;
}

function jsonPointerSegments(pointer: string): readonly string[] | undefined {
  if (pointer === "") return Object.freeze([]);
  if (!pointer.startsWith("/")) return undefined;
  const output: string[] = [];
  for (const token of pointer.slice(1).split("/")) {
    let decoded = "";
    for (let index = 0; index < token.length; index += 1) {
      const character = token[index]!;
      if (character !== "~") {
        decoded += character;
        continue;
      }
      const escape = token[index + 1];
      if (escape === "0") decoded += "~";
      else if (escape === "1") decoded += "/";
      else return undefined;
      index += 1;
    }
    output.push(decoded);
  }
  return Object.freeze(output);
}

function resolvePointer(root: unknown, pointer: string): unknown | undefined {
  const segments = jsonPointerSegments(pointer);
  if (segments === undefined) return undefined;
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length ||
        !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null ||
      !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    current = descriptor.value;
  }
  return current;
}

function causesCycle(
  keys: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): boolean {
  const state = new Map<string, "visiting" | "visited">();
  for (const root of keys) {
    if (state.get(root) === "visited") continue;
    const stack: Array<{ readonly key: string; next: number }> = [{ key: root, next: 0 }];
    state.set(root, "visiting");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const targets = edges.get(frame.key) ?? [];
      const target = targets[frame.next];
      if (target === undefined) {
        state.set(frame.key, "visited");
        stack.pop();
        continue;
      }
      frame.next += 1;
      const targetState = state.get(target);
      if (targetState === "visiting") return true;
      if (targetState === "visited") continue;
      state.set(target, "visiting");
      stack.push({ key: target, next: 0 });
    }
  }
  return false;
}

function parseArtifactJson(artifact: CapturedAdapterAttachment): unknown {
  if (artifact.mediaType !== "application/json") {
    throw traceError(
      "execution-trace-evidence-missing",
      `Evidence artifact ${artifact.artifactId} is not application/json.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes)) as unknown;
  } catch {
    throw traceError(
      "execution-trace-evidence-missing",
      `Evidence artifact ${artifact.artifactId} is not valid UTF-8 JSON.`,
    );
  }
  return parsed;
}

function verifySemantics(
  input: Schema.Schema.Type<typeof ExecutionTraceInputSchema>,
): void {
  const limits = ExecutionTraceRecordLimits;
  if (input.events.length > limits.maximumEvents) {
    throw traceError("execution-trace-limit", "Execution trace exceeds 100000 events.");
  }
  const scopeIds = new Set<string>();
  for (const scope of input.scopes) {
    if (scopeIds.has(scope.scopeId)) throw traceError("execution-trace-invalid", "Execution trace scopeId values must be unique.");
    scopeIds.add(scope.scopeId);
  }
  const eventKeys = new Set<string>();
  const causeEdges = new Map<string, string[]>();
  const clockUnits = new Map<string, string>();
  for (const event of input.events) {
    if (eventKeys.has(event.key)) throw traceError("execution-trace-invalid", "Execution trace event keys must be unique.");
    eventKeys.add(event.key);
    if (utf8.encode(event.summary).byteLength > limits.maximumSummaryBytes) {
      throw traceError("execution-trace-limit", "Execution trace event summary exceeds 512 UTF-8 bytes.");
    }
    if (event.payload !== undefined && utf8.encode(canonicalRecordJsonText(event.payload as RecordJson)).byteLength > limits.maximumPayloadBytes) {
      throw traceError("execution-trace-limit", "Execution trace event payload exceeds 16 KiB.");
    }
    if ((event.links?.length ?? 0) > limits.maximumLinksPerEvent ||
      (event.evidence?.length ?? 0) > limits.maximumEvidencePerEvent ||
      (event.scopeMemberships?.length ?? 0) > limits.maximumScopesPerEvent) {
      throw traceError("execution-trace-limit", "Execution trace event exceeds its link, evidence, or scope-membership limit.");
    }
    const evidenceKeys = new Set<string>();
    for (const evidence of event.evidence ?? []) {
      if (evidenceKeys.has(evidence.key)) throw traceError("execution-trace-invalid", "Execution trace evidence keys must be unique within an event.");
      evidenceKeys.add(evidence.key);
      if (jsonPointerSegments(evidence.pointer) === undefined) throw traceError("execution-trace-invalid", "Execution trace evidence pointer is not RFC 6901 syntax.");
    }
    const memberships = new Set<string>();
    for (const membership of event.scopeMemberships ?? []) {
      if (!scopeIds.has(membership.scopeId) || memberships.has(membership.scopeId)) {
        throw traceError("execution-trace-invalid", "Execution trace memberships must uniquely reference declared scopes.");
      }
      memberships.add(membership.scopeId);
    }
    if (event.time !== undefined) {
      const unit = clockUnits.get(event.time.clockId);
      if (unit !== undefined && unit !== event.time.unit) {
        throw traceError("execution-trace-invalid", "A trace clockId must use one unit.");
      }
      clockUnits.set(event.time.clockId, event.time.unit);
    }
  }
  for (const event of input.events) {
    for (const link of event.links ?? []) {
      if (!("targetKey" in link)) continue;
      if (!eventKeys.has(link.targetKey)) throw traceError("execution-trace-invalid", "Resolved execution trace links must target the same snapshot.");
      if (link.relation === "causes") {
        const edges = causeEdges.get(event.key) ?? [];
        edges.push(link.targetKey);
        causeEdges.set(event.key, edges);
      }
    }
  }
  if (causesCycle([...eventKeys], causeEdges)) {
    throw traceError("execution-trace-invalid", "Execution trace causes links must be acyclic.");
  }
}

export function createAdapterExecutionTraceCollector(
  artifacts: () => readonly CapturedAdapterAttachment[],
): AdapterExecutionTraceCollector {
  const accepted = new Map<string, AcceptedExecutionTrace>();
  const acceptedIds = new Set<string>();
  let eventCount = 0;
  let canonicalInputBytes = 0;
  let acceptedEvidenceTargetBytes = 0;
  let closed = false;
  let firstFailure: AdapterExecutionTraceError | undefined;
  let sealed: AdapterExecutionTraceSnapshot | undefined;

  const mintStableId = (prefix: "et" | "ee" | "ev", pending: Set<string>): string => {
    let candidate: string;
    do candidate = stableId(prefix); while (acceptedIds.has(candidate) || pending.has(candidate));
    pending.add(candidate);
    return candidate;
  };

  const fail = (cause: unknown): AdapterExecutionTraceError => {
    const error = cause instanceof AdapterExecutionTraceError
      ? cause
      : traceError("execution-trace-failed", "Execution trace capture failed.");
    if (!closed) firstFailure ??= error;
    return error;
  };

  const recordTrace = <Event extends import("../adapter-execution-trace.ts").ExecutionTraceEvent>(
    input: ExecutionTraceInput<Event>,
  ): Promise<ExecutionTraceReceipt> => {
    try {
      if (closed) throw traceError("execution-trace-closed", "Execution trace collection is closed.");
      const canonical = canonicalizeRecordJson(input, INPUT_LIMITS);
      if (Result.isFailure(canonical)) {
        throw traceError(
          canonical.failure.code === "record-json-limit-exceeded" ? "execution-trace-limit" : "execution-trace-invalid",
          "Execution trace must be finite plain JSON within the 64 MiB and depth limits.",
        );
      }
      const canonicalText = canonicalRecordJsonText(canonical.success);
      const snapshotBytes = utf8.encode(canonicalText).byteLength;
      const canonicalInputDigest = digest(canonicalText);
      const decoded = exactDecode(canonical.success);
      if (Result.isFailure(decoded)) throw traceError("execution-trace-invalid", "Execution trace envelope is invalid.");
      const snapshot = decoded.success;
      verifySemantics(snapshot);

      const prior = accepted.get(snapshot.traceId);
      if (prior !== undefined) {
        if (prior.canonicalInputDigest !== canonicalInputDigest) {
          throw traceError("execution-trace-conflict", "Conflicting snapshot for execution trace traceId.");
        }
        return Promise.resolve(prior.receipt);
      }
      if (accepted.size >= ExecutionTraceRecordLimits.maximumTraces ||
        eventCount + snapshot.events.length > ExecutionTraceRecordLimits.maximumEvents ||
        canonicalInputBytes + snapshotBytes > ExecutionTraceRecordLimits.maximumCanonicalInputBytes) {
        throw traceError("execution-trace-limit", "Execution trace exceeds the Attempt trace or event limit.");
      }

      const byArtifactId = new Map(artifacts().map((artifact) => [artifact.artifactId, artifact] as const));
      const parsedArtifacts = new Map<string, unknown>();
      const verifiedArtifacts = new Set<string>();
      const verifiedTargets = new Map<string, VerifiedEvidenceTarget>();
      let evidenceSourceBytes = 0;
      let evidenceTargetBytes = 0;
      const pendingIds = new Set<string>();
      const traceId = mintStableId("et", pendingIds);
      const receiptEvents: Array<ExecutionTraceReceipt["events"][number]> = [];
      const records: ExecutionTraceRecord[] = [];
      const header: ExecutionTraceHeaderRecord = Object.freeze({
        kind: "trace-header",
        traceId,
        sourceTraceId: snapshot.traceId,
        schema: Object.freeze({ ...snapshot.schema }),
        collection: Object.freeze({
          state: snapshot.collection.state,
          limitations: Object.freeze(snapshot.collection.limitations.map((limitation) => Object.freeze({ ...limitation }))),
        }) as ExecutionTraceHeaderRecord["collection"],
        scopes: Object.freeze(snapshot.scopes.map((scope) => Object.freeze({
          scopeId: scope.scopeId,
          label: scope.label,
          boundary: scope.boundary,
        }))),
      });
      records.push(header);

      for (const [ordinal, event] of snapshot.events.entries()) {
        const eventId = mintStableId("ee", pendingIds);
        const receiptEvidence: Array<{ readonly key: string; readonly evidenceId: string }> = [];
        const durableEvidence: ExecutionTraceEventRecord["evidence"][number][] = [];
        for (const evidence of event.evidence ?? []) {
          const artifact = byArtifactId.get(evidence.artifactId);
          if (artifact === undefined) {
            throw traceError("execution-trace-evidence-missing", `Evidence artifact ${evidence.artifactId} is not attached to this Attempt.`);
          }
          const artifactCacheKey = `${artifact.artifactId}\u0000${artifact.sha256}`;
          if (!verifiedArtifacts.has(artifactCacheKey)) {
            if (digest(artifact.bytes) !== artifact.sha256) {
              throw traceError("execution-trace-evidence-missing", `Evidence artifact ${artifact.artifactId} digest is invalid.`);
            }
            verifiedArtifacts.add(artifactCacheKey);
          }
          let artifactJson = parsedArtifacts.get(artifactCacheKey);
          if (artifactJson === undefined) {
            evidenceSourceBytes += artifact.bytes.byteLength;
            if (evidenceSourceBytes > ExecutionTraceRecordLimits.maximumEvidenceSourceBytes) {
              throw traceError("evidence-budget-exceeded", "Execution trace evidence source budget exceeded.");
            }
            artifactJson = parseArtifactJson(artifact);
            parsedArtifacts.set(artifactCacheKey, artifactJson);
          }
          const targetKey = `${artifact.artifactId}\u0000${artifact.sha256}\u0000${evidence.pointer}`;
          let verified = verifiedTargets.get(targetKey);
          if (verified === undefined) {
            const target = resolvePointer(artifactJson, evidence.pointer);
            if (target === undefined) {
              throw traceError("execution-trace-evidence-missing", `Evidence pointer ${evidence.pointer} does not resolve in ${artifact.artifactId}.`);
            }
            const canonicalTarget = canonicalizeRecordJson(target, TARGET_LIMITS);
            if (Result.isFailure(canonicalTarget)) {
              throw traceError(
                canonicalTarget.failure.code === "record-json-limit-exceeded" ? "evidence-budget-exceeded" : "execution-trace-evidence-missing",
                "Execution trace evidence target is invalid.",
              );
            }
            const targetBytes = utf8.encode(canonicalRecordJsonText(canonicalTarget.success));
            evidenceTargetBytes += targetBytes.byteLength;
            if (acceptedEvidenceTargetBytes + evidenceTargetBytes > ExecutionTraceRecordLimits.maximumEvidenceTargetBytes) {
              throw traceError("evidence-budget-exceeded", "Execution trace evidence target budget exceeded.");
            }
            verified = Object.freeze({
              artifactSha256: artifact.sha256,
              targetSha256: digest(targetBytes),
              targetByteLength: targetBytes.byteLength,
            });
            verifiedTargets.set(targetKey, verified);
          }
          const evidenceId = mintStableId("ev", pendingIds);
          receiptEvidence.push(Object.freeze({ key: evidence.key, evidenceId }));
          durableEvidence.push(Object.freeze({
            key: evidence.key,
            label: evidence.label,
            artifactId: evidence.artifactId,
            pointer: evidence.pointer,
            evidenceId,
            ...verified,
          }));
        }
        const durable: ExecutionTraceEventRecord = Object.freeze({
          kind: "event",
          traceId,
          eventId,
          ordinal,
          key: event.key,
          type: event.type,
          source: Object.freeze({ ...event.source }),
          ...(event.actor === undefined ? {} : { actor: Object.freeze({ ...event.actor }) }),
          ...(event.time === undefined ? {} : { time: Object.freeze({ ...event.time }) }),
          summary: event.summary,
          ...(event.payload === undefined ? {} : { payload: event.payload as TraceJson }),
          links: Object.freeze((event.links ?? []).map((link) => Object.freeze(
            "targetKey" in link
              ? { relation: link.relation, targetKey: link.targetKey }
              : { relation: link.relation, unresolved: Object.freeze({ ...link.unresolved }) },
          ))),
          evidence: Object.freeze(durableEvidence),
          scopeMemberships: Object.freeze((event.scopeMemberships ?? []).map((membership) => Object.freeze({ ...membership }))),
        });
        records.push(durable);
        receiptEvents.push(Object.freeze({
          key: event.key,
          eventId,
          evidence: Object.freeze(receiptEvidence),
        }));
      }

      for (const record of records) {
        if (Result.isFailure(canonicalizeRecordJson(record, PERSISTED_ITEM_LIMITS))) {
          throw traceError(
            "execution-trace-limit",
            "Execution trace header or event exceeds the portable Record item limit.",
          );
        }
      }

      const receipt: ExecutionTraceReceipt = Object.freeze({
        state: "accepted",
        traceId,
        events: Object.freeze(receiptEvents),
      });
      const retained: AcceptedExecutionTrace = Object.freeze({
        sourceTraceId: snapshot.traceId,
        canonicalInputDigest,
        receipt,
        records: Object.freeze(records),
      });
      accepted.set(snapshot.traceId, retained);
      for (const id of pendingIds) acceptedIds.add(id);
      eventCount += snapshot.events.length;
      canonicalInputBytes += snapshotBytes;
      acceptedEvidenceTargetBytes += evidenceTargetBytes;
      return Promise.resolve(receipt);
    } catch (cause) {
      return rejectSettled(fail(cause));
    }
  };

  return Object.freeze({
    recordTrace,
    failure: () => firstFailure,
    close: () => {
      if (closed) return;
      closed = true;
      sealed = Object.freeze({
        traces: Object.freeze([...accepted.values()]),
        failure: firstFailure,
      });
    },
    snapshot: () => {
      if (sealed === undefined) throw new Error("Execution trace collection must close before taking its snapshot.");
      return sealed;
    },
  });
}

/**
 * Fixed-family closure check repeated at publication. It deliberately uses
 * the durable records, not the original public input, so no bare artifactId
 * can cross the Attempt publication gate.
 */
export function validateExecutionTracePublication(
  snapshot: AdapterExecutionTraceSnapshot,
  artifacts: readonly CapturedAdapterAttachment[],
): void {
  const byArtifactId = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact] as const));
  const parsedArtifacts = new Map<string, unknown>();
  const verifiedArtifacts = new Set<string>();
  const verifiedTargets = new Map<string, VerifiedEvidenceTarget>();
  let sourceBytes = 0;
  let targetBytes = 0;
  const traceIds = new Set<string>();
  const sourceTraceIds = new Set<string>();
  let publishedEventCount = 0;
  for (const trace of snapshot.traces) {
    const [header, ...events] = trace.records;
    if (header?.kind !== "trace-header" || header.traceId !== trace.receipt.traceId ||
      traceIds.has(header.traceId) || sourceTraceIds.has(header.sourceTraceId) ||
      events.length !== trace.receipt.events.length) {
      throw traceError("execution-trace-failed", "Execution trace durable header is invalid.");
    }
    traceIds.add(header.traceId);
    sourceTraceIds.add(header.sourceTraceId);
    publishedEventCount += events.length;
    const scopeIds = new Set<string>();
    for (const scope of header.scopes) {
      if (scopeIds.has(scope.scopeId)) throw traceError("execution-trace-failed", "Execution trace durable scopes are invalid.");
      scopeIds.add(scope.scopeId);
    }
    const eventKeys = new Set<string>();
    const eventIds = new Set<string>();
    const evidenceIds = new Set<string>();
    const causeEdges = new Map<string, string[]>();
    const clockUnits = new Map<string, string>();
    for (const record of events) {
      const receiptEvent = trace.receipt.events[record.kind === "event" ? record.ordinal : -1];
      if (record.kind !== "event" || record.traceId !== header.traceId ||
        record.ordinal < 0 || record.ordinal >= events.length ||
        receiptEvent?.key !== record.key || receiptEvent.eventId !== record.eventId ||
        eventKeys.has(record.key) || eventIds.has(record.eventId)) {
        throw traceError("execution-trace-failed", "Execution trace durable event ownership is invalid.");
      }
      eventKeys.add(record.key);
      eventIds.add(record.eventId);
      const evidenceKeys = new Set<string>();
      for (const [index, evidence] of record.evidence.entries()) {
        if (evidenceKeys.has(evidence.key) || evidenceIds.has(evidence.evidenceId) ||
          receiptEvent.evidence[index]?.key !== evidence.key ||
          receiptEvent.evidence[index]?.evidenceId !== evidence.evidenceId) {
          throw traceError("execution-trace-failed", "Execution trace durable evidence identity is invalid.");
        }
        evidenceKeys.add(evidence.key);
        evidenceIds.add(evidence.evidenceId);
      }
      if (receiptEvent.evidence.length !== record.evidence.length) {
        throw traceError("execution-trace-failed", "Execution trace durable evidence receipt is invalid.");
      }
      const memberships = new Set<string>();
      for (const membership of record.scopeMemberships) {
        if (!scopeIds.has(membership.scopeId) || memberships.has(membership.scopeId)) {
          throw traceError("execution-trace-failed", "Execution trace durable membership is invalid.");
        }
        memberships.add(membership.scopeId);
      }
      if (record.time !== undefined) {
        const priorUnit = clockUnits.get(record.time.clockId);
        if (priorUnit !== undefined && priorUnit !== record.time.unit) {
          throw traceError("execution-trace-failed", "Execution trace durable clock unit is invalid.");
        }
        clockUnits.set(record.time.clockId, record.time.unit);
      }
      for (const link of record.links) {
        if ("targetKey" in link && link.relation === "causes") {
          const targets = causeEdges.get(record.key) ?? [];
          targets.push(link.targetKey);
          causeEdges.set(record.key, targets);
        }
      }
      for (const evidence of record.evidence) {
        const artifact = byArtifactId.get(evidence.artifactId);
        if (artifact === undefined || artifact.sha256 !== evidence.artifactSha256) {
          throw traceError("execution-trace-evidence-missing", "Execution trace evidence artifact closure is invalid.");
        }
        const artifactCacheKey = `${artifact.artifactId}\u0000${artifact.sha256}`;
        if (!verifiedArtifacts.has(artifactCacheKey)) {
          if (digest(artifact.bytes) !== evidence.artifactSha256) {
            throw traceError("execution-trace-evidence-missing", "Execution trace evidence artifact closure is invalid.");
          }
          verifiedArtifacts.add(artifactCacheKey);
        }
        let artifactJson = parsedArtifacts.get(artifactCacheKey);
        if (artifactJson === undefined) {
          sourceBytes += artifact.bytes.byteLength;
          if (sourceBytes > ExecutionTraceRecordLimits.maximumEvidenceSourceBytes) {
            throw traceError("evidence-budget-exceeded", "Execution trace evidence source budget exceeded at publication.");
          }
          artifactJson = parseArtifactJson(artifact);
          parsedArtifacts.set(artifactCacheKey, artifactJson);
        }
        const key = `${artifact.artifactId}\u0000${artifact.sha256}\u0000${evidence.pointer}`;
        let verified = verifiedTargets.get(key);
        if (verified === undefined) {
          const target = resolvePointer(artifactJson, evidence.pointer);
          if (target === undefined) throw traceError("execution-trace-evidence-missing", "Execution trace evidence pointer closure is invalid.");
          const canonical = canonicalizeRecordJson(target, TARGET_LIMITS);
          if (Result.isFailure(canonical)) throw traceError("execution-trace-evidence-missing", "Execution trace evidence target is invalid at publication.");
          const bytes = utf8.encode(canonicalRecordJsonText(canonical.success));
          targetBytes += bytes.byteLength;
          if (targetBytes > ExecutionTraceRecordLimits.maximumEvidenceTargetBytes) {
            throw traceError("evidence-budget-exceeded", "Execution trace evidence target budget exceeded at publication.");
          }
          verified = Object.freeze({
            artifactSha256: artifact.sha256,
            targetSha256: digest(bytes),
            targetByteLength: bytes.byteLength,
          });
          verifiedTargets.set(key, verified);
        }
        if (verified.targetSha256 !== evidence.targetSha256 ||
          verified.targetByteLength !== evidence.targetByteLength) {
          throw traceError("execution-trace-evidence-missing", "Execution trace evidence target digest closure is invalid.");
        }
      }
    }
    for (const record of events) {
      if (record.kind !== "event") continue;
      for (const link of record.links) {
        if ("targetKey" in link && !eventKeys.has(link.targetKey)) {
          throw traceError("execution-trace-failed", "Execution trace durable resolved link is invalid.");
        }
      }
    }
    if (causesCycle([...eventKeys], causeEdges)) {
      throw traceError("execution-trace-failed", "Execution trace durable causes links contain a cycle.");
    }
  }
  if (traceIds.size > ExecutionTraceRecordLimits.maximumTraces ||
    publishedEventCount > ExecutionTraceRecordLimits.maximumEvents) {
    throw traceError("execution-trace-limit", "Execution trace publication exceeds its trace or event limit.");
  }
}
