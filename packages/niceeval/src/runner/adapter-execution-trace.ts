import { createHash, randomBytes } from "node:crypto";
import { openSync, readSync, closeSync } from "node:fs";

import { Data, Result, Schema, SchemaIssue } from "effect";

import type { ExecutionTraceInput, ExecutionTraceReceipt, TraceJson } from "../adapter-execution-trace.ts";
import {
  canonicalTraceJsonChunks,
  displayTextHasForbiddenCharacter,
  parseTraceArtifactJson,
  snapshotTraceJson,
  ExecutionDisplayImageMediaTypes,
  ExecutionTraceInputSchema,
  type ExecutionDisplayBlockRecord,
  type ExecutionTraceEventRecord,
  type ExecutionTraceHeaderRecord,
  type ExecutionTraceRecord,
} from "../record/family/execution-traces/schema.ts";
import type { EvalResult } from "./types.ts";
import type { CapturedAdapterAttachment } from "./adapter-attachments.ts";

export class AdapterExecutionTraceError extends Data.TaggedError("AdapterExecutionTraceError")<{
  readonly code:
    | "execution-trace-invalid"
    | "execution-trace-conflict"
    | "execution-trace-evidence-missing"
    | "execution-trace-closed"
    | "execution-trace-failed"
    | "execution-display-invalid";
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

export function retainAdapterExecutionTraces(result: EvalResult, snapshot: AdapterExecutionTraceSnapshot): void {
  if (snapshot.traces.length > 0 || snapshot.failure !== undefined) captures.set(result, snapshot);
}

export function adapterExecutionTracesForResult(result: EvalResult): AdapterExecutionTraceSnapshot | undefined {
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

const exactDecode = Schema.decodeUnknownResult(ExecutionTraceInputSchema, {
  onExcessProperty: "error",
});
const formatSchemaIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function invalidEnvelope(error: Schema.SchemaError): AdapterExecutionTraceError {
  const displayIssue = formatSchemaIssues(error.issue).issues.find(
    (issue) => issue.path?.[0] === "events" && issue.path?.[2] === "display",
  );
  if (displayIssue !== undefined) {
    const path = (displayIssue.path ?? [])
      .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
      .join("")
      .replace(/^\./u, "");
    return traceError("execution-display-invalid", `${path}: invalid display block shape.`);
  }
  return traceError("execution-trace-invalid", "Execution trace envelope is invalid.");
}

interface VerifiedEvidenceTarget {
  readonly artifactSha256: string;
  readonly targetSha256: string;
  readonly targetByteLength: number;
}

function traceError(code: AdapterExecutionTraceError["code"], message: string): AdapterExecutionTraceError {
  return new AdapterExecutionTraceError({ code, message });
}

function digestCanonicalTraceJson(value: TraceJson): { readonly sha256: string; readonly byteLength: number } {
  const hash = createHash("sha256");
  let byteLength = 0;
  for (const chunk of canonicalTraceJsonChunks(value)) {
    byteLength += Buffer.byteLength(chunk);
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), byteLength };
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
  if (pointer === "") return [];
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
  return output;
}

function resolvePointer(root: unknown, pointer: string): unknown | undefined {
  const segments = jsonPointerSegments(pointer);
  if (segments === undefined) return undefined;
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) return undefined;
      const index = Number(segment);
      if (
        !Number.isSafeInteger(index) ||
        index >= current.length ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      )
        return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null || !Object.prototype.hasOwnProperty.call(current, segment))
      return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    current = descriptor.value;
  }
  return current;
}

function causesCycle(keys: readonly string[], edges: ReadonlyMap<string, readonly string[]>): boolean {
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
  const hash = createHash("sha256");
  let byteLength = 0;
  function* chunks(): Generator<Uint8Array> {
    const chunkBytes = 64 * 1024;
    if (artifact.filePath === undefined) {
      for (let offset = 0; offset < artifact.bytes.byteLength; offset += chunkBytes) {
        const chunk = artifact.bytes.subarray(offset, offset + chunkBytes);
        hash.update(chunk);
        byteLength += chunk.byteLength;
        yield chunk;
      }
      return;
    }
    const fd = openSync(artifact.filePath, "r");
    try {
      const buffer = new Uint8Array(chunkBytes);
      for (;;) {
        const count = readSync(fd, buffer, 0, buffer.byteLength, null);
        if (count === 0) break;
        const chunk = buffer.subarray(0, count);
        hash.update(chunk);
        byteLength += chunk.byteLength;
        yield chunk;
      }
    } finally {
      closeSync(fd);
    }
  }
  let parsed: unknown;
  try {
    parsed = parseTraceArtifactJson(chunks());
  } catch {
    throw traceError(
      "execution-trace-evidence-missing",
      `Evidence artifact ${artifact.artifactId} could not be read as UTF-8 JSON.`,
    );
  }
  if (byteLength !== artifact.byteLength || hash.digest("hex") !== artifact.sha256) {
    throw traceError(
      "execution-trace-evidence-missing",
      `Evidence artifact ${artifact.artifactId} integrity check failed.`,
    );
  }
  return parsed;
}

type InputEvent = Schema.Schema.Type<typeof ExecutionTraceInputSchema>["events"][number];
type InputDisplayBlock = NonNullable<InputEvent["display"]>[number];

function displayInvalid(
  eventIndex: number,
  blockIndex: number | undefined,
  field: string,
  reason: string,
): AdapterExecutionTraceError {
  const path =
    blockIndex === undefined ? `events[${eventIndex}].display` : `events[${eventIndex}].display[${blockIndex}]`;
  return traceError("execution-display-invalid", `${path}.${field}: ${reason}`);
}

function checkDisplayString(
  value: string,
  eventIndex: number,
  blockIndex: number,
  field: string,
  singleLine = false,
): void {
  if (displayTextHasForbiddenCharacter(value)) {
    throw displayInvalid(eventIndex, blockIndex, field, "contains a control or bidirectional formatting character.");
  }
  if (singleLine && value.includes("\n")) {
    throw displayInvalid(eventIndex, blockIndex, field, "must not contain a line break.");
  }
}

/** Validates one event's display blocks against the closed vocabulary. */
function verifyDisplay(event: InputEvent, eventIndex: number): void {
  const display = event.display;
  if (display === undefined) return;
  if (display.length === 0)
    throw displayInvalid(eventIndex, undefined, "length", "must not be empty; omit display instead.");
  for (const [blockIndex, block] of display.entries()) {
    switch (block.kind) {
      case "text":
        checkDisplayString(block.text, eventIndex, blockIndex, "text");
        break;
      case "message":
        checkDisplayString(block.text, eventIndex, blockIndex, "text");
        if (block.speaker !== undefined) {
          checkDisplayString(block.speaker, eventIndex, blockIndex, "speaker", true);
        }
        break;
      case "fields":
        for (const [fieldIndex, field] of block.fields.entries()) {
          checkDisplayString(field.label, eventIndex, blockIndex, `fields[${fieldIndex}].label`, true);
          if (typeof field.value === "string")
            checkDisplayString(field.value, eventIndex, blockIndex, `fields[${fieldIndex}].value`);
        }
        break;
      case "code":
        checkDisplayString(block.text, eventIndex, blockIndex, "text");
        if (block.language !== undefined) {
          checkDisplayString(block.language, eventIndex, blockIndex, "language", true);
        }
        break;
      case "image":
        checkDisplayString(block.alt, eventIndex, blockIndex, "alt", true);
        break;
    }
  }
}

/** Fixes each image block to the accepted attachment descriptor. */
function durableDisplay(
  display: readonly InputDisplayBlock[] | undefined,
  eventIndex: number,
  byArtifactId: ReadonlyMap<string, CapturedAdapterAttachment>,
): readonly [ExecutionDisplayBlockRecord, ...ExecutionDisplayBlockRecord[]] | undefined {
  if (display === undefined) return undefined;
  const blocks = display.map((block, blockIndex): ExecutionDisplayBlockRecord => {
    if (block.kind !== "image") return block as ExecutionDisplayBlockRecord;
    const artifact = byArtifactId.get(block.artifactId);
    if (artifact === undefined) {
      throw displayInvalid(
        eventIndex,
        blockIndex,
        "artifactId",
        `${block.artifactId} is not attached to this Attempt.`,
      );
    }
    if (!ExecutionDisplayImageMediaTypes.has(artifact.mediaType)) {
      throw displayInvalid(
        eventIndex,
        blockIndex,
        "artifactId",
        `${block.artifactId} is ${artifact.mediaType}, not a supported image type.`,
      );
    }
    return {
      kind: "image",
      artifactId: block.artifactId,
      alt: block.alt,
      mediaType: artifact.mediaType as Extract<ExecutionDisplayBlockRecord, { kind: "image" }>["mediaType"],
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
    };
  });
  return blocks.length === 0 ? undefined : (blocks as [ExecutionDisplayBlockRecord, ...ExecutionDisplayBlockRecord[]]);
}

function verifySemantics(input: Schema.Schema.Type<typeof ExecutionTraceInputSchema>): void {
  const scopeIds = new Set<string>();
  for (const scope of input.scopes) {
    if (scopeIds.has(scope.scopeId))
      throw traceError("execution-trace-invalid", "Execution trace scopeId values must be unique.");
    scopeIds.add(scope.scopeId);
  }
  const eventKeys = new Set<string>();
  const causeEdges = new Map<string, string[]>();
  const clockUnits = new Map<string, string>();
  for (const [eventIndex, event] of input.events.entries()) {
    verifyDisplay(event, eventIndex);
    if (eventKeys.has(event.key))
      throw traceError("execution-trace-invalid", "Execution trace event keys must be unique.");
    eventKeys.add(event.key);
    const evidenceKeys = new Set<string>();
    for (const evidence of event.evidence ?? []) {
      if (evidenceKeys.has(evidence.key))
        throw traceError("execution-trace-invalid", "Execution trace evidence keys must be unique within an event.");
      evidenceKeys.add(evidence.key);
      if (jsonPointerSegments(evidence.pointer) === undefined)
        throw traceError("execution-trace-invalid", "Execution trace evidence pointer is not RFC 6901 syntax.");
    }
    const memberships = new Set<string>();
    for (const membership of event.scopeMemberships ?? []) {
      if (!scopeIds.has(membership.scopeId) || memberships.has(membership.scopeId)) {
        throw traceError(
          "execution-trace-invalid",
          "Execution trace memberships must uniquely reference declared scopes.",
        );
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
      if (!eventKeys.has(link.targetKey))
        throw traceError("execution-trace-invalid", "Resolved execution trace links must target the same snapshot.");
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
  let closed = false;
  let firstFailure: AdapterExecutionTraceError | undefined;
  let sealed: AdapterExecutionTraceSnapshot | undefined;

  const mintStableId = (prefix: "et" | "ee" | "ev", pending: Set<string>): string => {
    let candidate: string;
    do candidate = stableId(prefix);
    while (acceptedIds.has(candidate) || pending.has(candidate));
    pending.add(candidate);
    return candidate;
  };

  const fail = (cause: unknown): AdapterExecutionTraceError => {
    const error =
      cause instanceof AdapterExecutionTraceError
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
      const canonical = snapshotTraceJson(input);
      if (Result.isFailure(canonical)) {
        if (canonical.failure.path[0] === "events" && canonical.failure.path[2] === "display") {
          const path = canonical.failure.path
            .map((part) => (/^\d+$/u.test(part) ? `[${part}]` : `.${part}`))
            .join("")
            .replace(/^\./u, "");
          throw traceError(
            "execution-display-invalid",
            `${path}: display must contain finite plain JSON and valid UTF-8 text.`,
          );
        }
        throw traceError("execution-trace-invalid", "Execution trace must be finite plain JSON with valid UTF-8 text.");
      }
      const canonicalInputDigest = digestCanonicalTraceJson(canonical.success).sha256;
      const decoded = exactDecode(canonical.success);
      if (Result.isFailure(decoded)) throw invalidEnvelope(decoded.failure);
      const snapshot = decoded.success;
      verifySemantics(snapshot);

      const prior = accepted.get(snapshot.traceId);
      if (prior !== undefined) {
        if (prior.canonicalInputDigest !== canonicalInputDigest) {
          throw traceError("execution-trace-conflict", "Conflicting snapshot for execution trace traceId.");
        }
        return Promise.resolve(prior.receipt);
      }
      const byArtifactId = new Map(artifacts().map((artifact) => [artifact.artifactId, artifact] as const));
      const parsedArtifacts = new Map<string, unknown>();
      const verifiedTargets = new Map<string, VerifiedEvidenceTarget>();
      const pendingIds = new Set<string>();
      const traceId = mintStableId("et", pendingIds);
      const receiptEvents: Array<ExecutionTraceReceipt["events"][number]> = [];
      const records: ExecutionTraceRecord[] = [];
      const header: ExecutionTraceHeaderRecord = {
        kind: "trace-header",
        traceId,
        sourceTraceId: snapshot.traceId,
        schema: snapshot.schema,
        collection: {
          state: snapshot.collection.state,
          limitations: snapshot.collection.limitations,
        } as ExecutionTraceHeaderRecord["collection"],
        scopes: snapshot.scopes.map((scope) => ({
          scopeId: scope.scopeId,
          label: scope.label,
          boundary: scope.boundary,
        })),
      };
      records.push(header);

      for (const [ordinal, event] of snapshot.events.entries()) {
        const eventId = mintStableId("ee", pendingIds);
        const receiptEvidence: Array<{ readonly key: string; readonly evidenceId: string }> = [];
        const durableEvidence: ExecutionTraceEventRecord["evidence"][number][] = [];
        for (const evidence of event.evidence ?? []) {
          const artifact = byArtifactId.get(evidence.artifactId);
          if (artifact === undefined) {
            throw traceError(
              "execution-trace-evidence-missing",
              `Evidence artifact ${evidence.artifactId} is not attached to this Attempt.`,
            );
          }
          const artifactCacheKey = `${artifact.artifactId}\u0000${artifact.sha256}`;
          let artifactJson = parsedArtifacts.get(artifactCacheKey);
          if (artifactJson === undefined) {
            artifactJson = parseArtifactJson(artifact);
            parsedArtifacts.set(artifactCacheKey, artifactJson);
          }
          const targetKey = `${artifact.artifactId}\u0000${artifact.sha256}\u0000${evidence.pointer}`;
          let verified = verifiedTargets.get(targetKey);
          if (verified === undefined) {
            const target = resolvePointer(artifactJson, evidence.pointer);
            if (target === undefined) {
              throw traceError(
                "execution-trace-evidence-missing",
                `Evidence pointer ${evidence.pointer} does not resolve in ${artifact.artifactId}.`,
              );
            }
            const canonicalTarget = snapshotTraceJson(target);
            if (Result.isFailure(canonicalTarget)) {
              throw traceError("execution-trace-evidence-missing", "Execution trace evidence target is invalid.");
            }
            const targetIdentity = digestCanonicalTraceJson(canonicalTarget.success);
            verified = {
              artifactSha256: artifact.sha256,
              targetSha256: targetIdentity.sha256,
              targetByteLength: targetIdentity.byteLength,
            };
            verifiedTargets.set(targetKey, verified);
          }
          const evidenceId = mintStableId("ev", pendingIds);
          receiptEvidence.push(Object.freeze({ key: evidence.key, evidenceId }));
          durableEvidence.push({
            key: evidence.key,
            label: evidence.label,
            artifactId: evidence.artifactId,
            pointer: evidence.pointer,
            evidenceId,
            ...verified,
          });
        }
        const durable: ExecutionTraceEventRecord = {
          kind: "event",
          traceId,
          eventId,
          ordinal,
          key: event.key,
          type: event.type,
          source: event.source,
          ...(event.actor === undefined ? {} : { actor: event.actor }),
          ...(event.time === undefined ? {} : { time: event.time }),
          summary: event.summary,
          ...(event.payload === undefined ? {} : { payload: event.payload as TraceJson }),
          links: (event.links ?? []).map((link) =>
            "targetKey" in link
              ? { relation: link.relation, targetKey: link.targetKey }
              : { relation: link.relation, unresolved: link.unresolved },
          ),
          evidence: durableEvidence,
          scopeMemberships: event.scopeMemberships ?? [],
          ...(() => {
            const display = durableDisplay(event.display, ordinal, byArtifactId);
            return display === undefined ? {} : { display };
          })(),
        };
        records.push(durable);
        receiptEvents.push(
          Object.freeze({
            key: event.key,
            eventId,
            evidence: Object.freeze(receiptEvidence),
          }),
        );
      }

      const receipt: ExecutionTraceReceipt = Object.freeze({
        state: "accepted",
        traceId,
        events: Object.freeze(receiptEvents),
      });
      const retained: AcceptedExecutionTrace = {
        sourceTraceId: snapshot.traceId,
        canonicalInputDigest,
        receipt,
        records,
      };
      accepted.set(snapshot.traceId, retained);
      for (const id of pendingIds) acceptedIds.add(id);
      return Promise.resolve(receipt);
    } catch (cause) {
      return rejectSettled(fail(cause));
    }
  };

  return {
    recordTrace,
    failure: () => firstFailure,
    close: () => {
      if (closed) return;
      closed = true;
      sealed = {
        traces: [...accepted.values()],
        failure: firstFailure,
      };
    },
    snapshot: () => {
      if (sealed === undefined) throw new Error("Execution trace collection must close before taking its snapshot.");
      return sealed;
    },
  };
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
  const verifiedTargets = new Map<string, VerifiedEvidenceTarget>();
  const traceIds = new Set<string>();
  const sourceTraceIds = new Set<string>();
  for (const trace of snapshot.traces) {
    const header = trace.records[0];
    const eventCount = trace.records.length - 1;
    if (
      header?.kind !== "trace-header" ||
      header.traceId !== trace.receipt.traceId ||
      traceIds.has(header.traceId) ||
      sourceTraceIds.has(header.sourceTraceId) ||
      eventCount !== trace.receipt.events.length
    ) {
      throw traceError("execution-trace-failed", "Execution trace durable header is invalid.");
    }
    traceIds.add(header.traceId);
    sourceTraceIds.add(header.sourceTraceId);
    const scopeIds = new Set<string>();
    for (const scope of header.scopes) {
      if (scopeIds.has(scope.scopeId))
        throw traceError("execution-trace-failed", "Execution trace durable scopes are invalid.");
      scopeIds.add(scope.scopeId);
    }
    const eventKeys = new Set<string>();
    const eventIds = new Set<string>();
    const evidenceIds = new Set<string>();
    const causeEdges = new Map<string, string[]>();
    const clockUnits = new Map<string, string>();
    for (let index = 1; index < trace.records.length; index += 1) {
      const record = trace.records[index]!;
      const receiptEvent = trace.receipt.events[record.kind === "event" ? record.ordinal : -1];
      if (
        record.kind !== "event" ||
        record.traceId !== header.traceId ||
        record.ordinal < 0 ||
        record.ordinal >= eventCount ||
        receiptEvent?.key !== record.key ||
        receiptEvent.eventId !== record.eventId ||
        eventKeys.has(record.key) ||
        eventIds.has(record.eventId)
      ) {
        throw traceError("execution-trace-failed", "Execution trace durable event ownership is invalid.");
      }
      eventKeys.add(record.key);
      eventIds.add(record.eventId);
      const evidenceKeys = new Set<string>();
      for (const [index, evidence] of record.evidence.entries()) {
        if (
          evidenceKeys.has(evidence.key) ||
          evidenceIds.has(evidence.evidenceId) ||
          receiptEvent.evidence[index]?.key !== evidence.key ||
          receiptEvent.evidence[index]?.evidenceId !== evidence.evidenceId
        ) {
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
      for (const block of record.display ?? []) {
        if (block.kind !== "image") continue;
        const artifact = byArtifactId.get(block.artifactId);
        if (
          artifact === undefined ||
          artifact.sha256 !== block.sha256 ||
          artifact.byteLength !== block.byteLength ||
          artifact.mediaType !== block.mediaType
        ) {
          throw traceError("execution-trace-evidence-missing", "Execution display image artifact closure is invalid.");
        }
      }
      for (const evidence of record.evidence) {
        const artifact = byArtifactId.get(evidence.artifactId);
        if (artifact === undefined || artifact.sha256 !== evidence.artifactSha256) {
          throw traceError("execution-trace-evidence-missing", "Execution trace evidence artifact closure is invalid.");
        }
        const artifactCacheKey = `${artifact.artifactId}\u0000${artifact.sha256}`;
        let artifactJson = parsedArtifacts.get(artifactCacheKey);
        if (artifactJson === undefined) {
          artifactJson = parseArtifactJson(artifact);
          parsedArtifacts.set(artifactCacheKey, artifactJson);
        }
        const key = `${artifact.artifactId}\u0000${artifact.sha256}\u0000${evidence.pointer}`;
        let verified = verifiedTargets.get(key);
        if (verified === undefined) {
          const target = resolvePointer(artifactJson, evidence.pointer);
          if (target === undefined)
            throw traceError(
              "execution-trace-evidence-missing",
              "Execution trace evidence pointer closure is invalid.",
            );
          const canonical = snapshotTraceJson(target);
          if (Result.isFailure(canonical))
            throw traceError(
              "execution-trace-evidence-missing",
              "Execution trace evidence target is invalid at publication.",
            );
          const targetIdentity = digestCanonicalTraceJson(canonical.success);
          verified = {
            artifactSha256: artifact.sha256,
            targetSha256: targetIdentity.sha256,
            targetByteLength: targetIdentity.byteLength,
          };
          verifiedTargets.set(key, verified);
        }
        if (
          verified.targetSha256 !== evidence.targetSha256 ||
          verified.targetByteLength !== evidence.targetByteLength
        ) {
          throw traceError(
            "execution-trace-evidence-missing",
            "Execution trace evidence target digest closure is invalid.",
          );
        }
      }
    }
    for (let index = 1; index < trace.records.length; index += 1) {
      const record = trace.records[index]!;
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
}
