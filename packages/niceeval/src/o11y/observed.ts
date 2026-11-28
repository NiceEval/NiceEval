import { redactJsonEvidence, type RedactEvidenceText } from "../sandbox/redaction.ts";
import { randomBytes } from "node:crypto";
import { isObject } from "effect/Predicate";

import type { OriginalCommandOpaqueReason, StreamEvent } from "./types.ts";
import { LOGICAL_COMMAND_NORMALIZER } from "./command-projection.ts";
import {
  entityIdFromEntropy,
  makeSafeText,
  makePositiveSafeInteger,
  makeSafeIdentifier,
  makeSourceNativeToolName,
  utf8ByteLength,
  type EventId,
  type ItemId,
  type PositiveSafeInteger,
  type SafeIdentifier,
  type SafeText,
  type SessionScopeId,
  type SourceNativeToolName,
  type ToolOccurrenceId,
  type TurnId,
} from "../record/family/source-receipt/model.ts";
import { MAX_SOURCE_NATIVE_TOOL_NAME_BYTES } from "../record/family/source-receipt/limits.ts";
import type { SourceReceiptLimitation } from "../record/family/source-receipt/index.ts";

export type ToolOccurrenceRelation =
  | { readonly state: "exact"; readonly toolOccurrenceId: ToolOccurrenceId }
  | {
      readonly state: "unavailable";
      readonly reason: "orphan-finish" | "ambiguous-operation";
    };

/**
 * Durable copy of the Adapter's command classification for one tool-start.
 * Tokens are redacted like every other Turn text and never truncated; an absent
 * classification is omitted from the item and reads back as unclassified.
 */
export type ObservedToolCommand =
  | { readonly kind: "not-command" }
  | { readonly kind: "command"; readonly logical: ObservedLogicalCommand };

export type ObservedLogicalCommand =
  | {
      readonly state: "available";
      readonly normalization: "identity" | "pnpm-exec" | "npx";
      readonly executable: SafeText;
      readonly args: readonly SafeText[];
    }
  | {
      readonly state: "opaque";
      readonly reason: "original-opaque";
      readonly originalReason: OriginalCommandOpaqueReason;
    }
  | {
      readonly state: "opaque";
      readonly reason: "unsupported-wrapper-form" | "ambiguous-wrapper-target" | "multiple-executions";
    };

export interface ObservedTextTruncation {
  readonly state: "truncated";
  readonly retainedBytes: number;
  readonly originalBytes?: number | undefined;
}

export interface ObservedSourceEventBase {
  readonly textTruncations?: Readonly<Record<string, ObservedTextTruncation>> | undefined;
  readonly itemId: ItemId;
  readonly eventId: EventId;
  readonly sessionSequence: PositiveSafeInteger;
}

export type ObservedSourceEvent =
  | (ObservedSourceEventBase & {
      readonly kind: "message";
      readonly role: "user" | "assistant";
      readonly text: SafeText;
    })
  | (ObservedSourceEventBase & {
      readonly kind: "tool-start";
      readonly toolOccurrenceId: ToolOccurrenceId;
      readonly tool: SourceNativeToolName;
      readonly inputSummary: SafeText;
      readonly command?: ObservedToolCommand | undefined;
    })
  | (ObservedSourceEventBase & {
      readonly kind: "tool-finish";
      readonly occurrence: ToolOccurrenceRelation;
      readonly outcome: "completed" | "rejected" | "failed" | "cancelled";
      readonly outputSummary: SafeText;
    })
  | (ObservedSourceEventBase & {
      readonly kind: "thinking-summary" | "compaction" | "context-injection";
      readonly summary: SafeText;
    })
  | (ObservedSourceEventBase & {
      readonly kind: "subagent";
      readonly state: "started" | "completed" | "failed";
      readonly label: SafeIdentifier;
      readonly summary: SafeText;
    })
  | (ObservedSourceEventBase & {
      readonly kind: "input-request";
      readonly state: "requested" | "answered" | "cancelled";
      readonly promptSummary: SafeText;
      readonly responseSummary: SafeText | null;
    })
  | (ObservedSourceEventBase & {
      readonly kind: "skill-load" | "conversation-error";
      readonly code: SafeIdentifier;
      readonly summary: SafeText;
    });

/** One immutable physical-send cut produced before events reach a consumer. */
export interface ObservedTurnSnapshot {
  readonly sessionId: SessionScopeId;
  readonly turnId: TurnId;
  readonly throughSessionSequence: PositiveSafeInteger;
  readonly collectionAtCut: "complete" | "partial";
  readonly items: readonly ObservedSourceEvent[];
  readonly limitations: readonly SourceReceiptLimitation[];
}

export interface ObservedSessionSnapshot {
  readonly sessionId: SessionScopeId;
  readonly throughSessionSequence: number;
  readonly turns: readonly ObservedTurnSnapshot[];
}

export interface ObservedAttemptCut {
  readonly sessions: readonly {
    readonly sessionId: SessionScopeId;
    readonly throughSessionSequence: number;
  }[];
}

interface SessionCorrelationState {
  sequence: number;
  readonly openByOperationId: Map<string, ToolOccurrenceId>;
  readonly openSubagentLabels: Map<string, string>;
  readonly ambiguousOperationIds: Set<string>;
  readonly finishedOperationIds: Set<string>;
}

const observedTurnDraftTypeId: unique symbol = Symbol("@niceeval/o11y/ObservedTurnDraft");

export interface ObservedTurnDraft {
  readonly [observedTurnDraftTypeId]: () => void;
}

interface TurnDraftState {
  readonly sessionId: SessionScopeId;
  readonly turnId: TurnId;
  readonly userEvent: Extract<StreamEvent, { readonly type: "message"; readonly role: "user" }>;
  readonly items: ObservedSourceEvent[];
  readonly evaluationItems: ObservedSourceEvent[];
  readonly evaluationEvents: StreamEvent[];
  readonly limitations: SourceReceiptLimitation[];
  historyLimited: boolean;
  finalized: boolean;
}

/** Attempt-local matcher material. It is never serialized into the Record. */
export interface ObservedEvaluationSegment {
  readonly sessionId: SessionScopeId;
  readonly turnId: TurnId;
  readonly items: readonly ObservedSourceEvent[];
  readonly events: readonly StreamEvent[];
  readonly collectionAtCut: "complete";
  readonly historyLimited: boolean;
}

export interface ObservedEventIngestionOptions {
  /** Attempt-local secret replacement supplied by the owning runtime. */
  readonly normalizeText?: RedactEvidenceText | undefined;
  readonly normalizeEvaluationText?: (() => RedactEvidenceText) | undefined;
}

const returnedTurnSnapshots = new WeakMap<object, ObservedTurnSnapshot>();

/** Returns the exact immutable cut associated with a terminal Adapter Turn. */
export function observedSnapshotForTurn(turn: object): ObservedTurnSnapshot | undefined {
  return returnedTurnSnapshots.get(turn);
}

/** @internal SessionManager binds the returned Turn only after the cut is sealed. */
export function bindObservedSnapshotToTurn(turn: object, snapshot: ObservedTurnSnapshot): void {
  returnedTurnSnapshots.set(turn, snapshot);
}

export function mintSessionScopeId(): SessionScopeId {
  return mintEntity("session-scope");
}

/**
 * The sole stateful observed-event ingestion owner. Adapter operation IDs
 * never escape these Session-local maps.
 */
export class ObservedEventIngestionCorrelator {
  private readonly sessions = new Map<SessionScopeId, SessionCorrelationState>();
  private readonly drafts = new WeakMap<object, TurnDraftState>();
  private readonly evaluationBySnapshot = new Map<ObservedTurnSnapshot, ObservedEvaluationSegment>();
  private readonly normalizeText: RedactEvidenceText;
  private readonly normalizeEvaluationText: () => RedactEvidenceText;

  constructor(options: ObservedEventIngestionOptions = {}) {
    this.normalizeText = options.normalizeText ?? ((value) => value);
    this.normalizeEvaluationText = options.normalizeEvaluationText ?? (() => this.normalizeText);
  }

  beginTurn(input: {
    readonly sessionId: SessionScopeId;
    readonly turnId: TurnId;
    readonly userEvent: Extract<StreamEvent, { readonly type: "message"; readonly role: "user" }>;
  }): ObservedTurnDraft {
    const draft = {
      [observedTurnDraftTypeId]: () => undefined,
    } as ObservedTurnDraft;
    const state: TurnDraftState = {
      sessionId: input.sessionId,
      turnId: input.turnId,
      userEvent: input.userEvent,
      items: [],
      evaluationItems: [],
      evaluationEvents: [],
      limitations: [],
      historyLimited: false,
      finalized: false,
    };
    this.drafts.set(draft, state);
    return draft;
  }

  finishTurn(draft: ObservedTurnDraft, adapterEvents: readonly StreamEvent[]): ObservedTurnSnapshot {
    const state = this.drafts.get(draft as object);
    if (state === undefined || state.finalized) {
      throw new Error("Observed event ingestion draft is unavailable or already sealed");
    }
    this.ingest(state, state.userEvent);
    for (const event of adapterEvents) this.ingest(state, event);
    state.finalized = true;
    const session = this.session(state.sessionId);
    const throughSessionSequence = positive(Math.max(1, session.sequence));
    const snapshot = {
      sessionId: state.sessionId,
      turnId: state.turnId,
      throughSessionSequence,
      collectionAtCut: state.limitations.length > 0 ? ("partial" as const) : ("complete" as const),
      items: state.items,
      limitations: state.limitations,
    };
    this.evaluationBySnapshot.set(snapshot, {
      sessionId: state.sessionId,
      turnId: state.turnId,
      items: state.evaluationItems,
      events: state.evaluationEvents,
      historyLimited: state.historyLimited,
      collectionAtCut: "complete" as const,
    });
    this.drafts.delete(draft as object);
    return snapshot;
  }

  /** Resolve matcher-only material while the owning Attempt is still evaluating. */
  evaluationSegment(snapshot: ObservedTurnSnapshot): ObservedEvaluationSegment | undefined {
    return this.evaluationBySnapshot.get(snapshot);
  }

  /** Idempotently release all high-cardinality matcher material for this Attempt. */
  releaseEvaluationSegments(): void {
    this.evaluationBySnapshot.clear();
  }

  throughSequence(sessionId: SessionScopeId): number {
    return this.sessions.get(sessionId)?.sequence ?? 0;
  }

  registerSession(sessionId: SessionScopeId): void {
    this.session(sessionId);
  }

  attemptCut(): ObservedAttemptCut {
    return {
      sessions: [...this.sessions.entries()]
        .map(([sessionId, state]) => ({
          sessionId,
          throughSessionSequence: state.sequence,
        }))
        .sort((left, right) => compareText(left.sessionId, right.sessionId)),
    };
  }

  private session(sessionId: SessionScopeId): SessionCorrelationState {
    const current = this.sessions.get(sessionId);
    if (current !== undefined) return current;
    const created: SessionCorrelationState = {
      sequence: 0,
      openByOperationId: new Map(),
      openSubagentLabels: new Map(),
      ambiguousOperationIds: new Set(),
      finishedOperationIds: new Set(),
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  private ingest(draft: TurnDraftState, event: StreamEvent): void {
    const session = this.session(draft.sessionId);
    session.sequence += 1;
    const sessionSequence = positive(session.sequence);
    const limitationStart = draft.limitations.length;
    const base = {
      itemId: mintEntity("item"),
      eventId: mintEntity("event"),
      sessionSequence,
    };
    const hasRedaction = (event.redacted?.length ?? 0) > 0;
    const hasTruncation = (event.truncated?.length ?? 0) > 0;
    if (hasRedaction) {
      this.limit(draft, {
        code: "redacted",
        target: "turn-item",
        replacementOrOmittedCount: positive(event.redacted!.length),
      });
    }
    if (hasTruncation) {
      const omitted = event.truncated!.reduce((count, entry) => count + Math.max(1, entry.originalBytes), 0);
      this.limit(draft, {
        code: "text-truncated",
        target: "turn-item",
        replacementOrOmittedCount: positive(omitted),
      });
    }
    function unavailableTextValue(): string | undefined {
      if (hasRedaction) return "<redacted>";
      if (hasTruncation) return "<truncated>";
      return undefined;
    }
    const unavailableText = unavailableTextValue();

    const textTruncations: Record<string, ObservedTextTruncation> = {};
    const evaluationTruncations: Record<string, ObservedTextTruncation> = {};
    const normalizeEvaluationText = this.normalizeEvaluationText();
    const evaluationFields: Record<string, string> = {};
    const evaluation = { limitations: [] as SourceReceiptLimitation[] };
    type Projection = Pick<TurnDraftState, "limitations">;
    const project = <Value extends string>(
      name: string,
      read: (projection: Projection, normalizeText: (value: string) => string) => Value,
      tracksTruncation = false,
    ): Value => {
      function readField(
        projection: Projection,
        normalizeText: (value: string) => string,
        truncations: Record<string, ObservedTextTruncation>,
      ): Value {
        const value = read(projection, normalizeText);
        if (tracksTruncation && hasTruncation) {
          truncations[name] = { state: "truncated", retainedBytes: utf8ByteLength(value) };
        }
        return value;
      }
      const recorded = readField(draft, this.normalizeText, textTruncations);
      if (normalizeEvaluationText !== this.normalizeText) {
        evaluationFields[name] = readField(evaluation, normalizeEvaluationText, evaluationTruncations);
      }
      return recorded;
    };
    const field = (
      name: string,
      read: (projection: Projection, normalizeText: (value: string) => string) => SafeText,
    ) => project(name, read, true);
    let observed: ObservedSourceEvent;
    switch (event.type) {
      case "message":
        observed = {
          ...base,
          kind: "message" as const,
          role: event.role,
          text: field("text", (projection, normalize) =>
            this.text(unavailableText ?? event.text, projection, normalize),
          ),
        };
        break;
      case "operation.started":
        if (event.operation.kind === "tool") {
          const operation = event.operation;
          const toolOccurrenceId = mintEntity("tool-occurrence");
          const prior = session.openByOperationId.get(event.operationId);
          session.finishedOperationIds.delete(event.operationId);
          if (session.ambiguousOperationIds.has(event.operationId)) {
            // Once overlapping opens make the transient key ambiguous, no
            // later finish can be assigned to a particular occurrence.
          } else if (prior !== undefined) {
            session.openByOperationId.delete(event.operationId);
            session.ambiguousOperationIds.add(event.operationId);
          } else {
            session.openByOperationId.set(event.operationId, toolOccurrenceId);
          }
          const command = this.toolCommand(operation.command, draft, unavailableText);
          observed = {
            ...base,
            kind: "tool-start" as const,
            ...(command === undefined ? {} : { command }),
            toolOccurrenceId,
            tool: project("tool", (projection, normalize) => this.toolName(operation.name, projection, normalize)),
            inputSummary: field("inputSummary", (projection, normalize) =>
              unavailableText === undefined
                ? this.json(operation.input, projection, normalize)
                : this.text(unavailableText, projection, normalize),
            ),
          };
        } else {
          const label = project("label", (projection, normalize) =>
            this.identifier(event.operation.name, projection, normalize),
          );
          session.openSubagentLabels.set(event.operationId, event.operation.name);
          observed = {
            ...base,
            kind: "subagent" as const,
            state: "started" as const,
            label,
            summary: field("summary", (projection, normalize) =>
              this.text(unavailableText ?? "Subagent started.", projection, normalize),
            ),
          };
        }
        break;
      case "operation.finished":
        if (event.kind === "tool") {
          const open = session.openByOperationId.get(event.operationId);
          const ambiguous =
            session.ambiguousOperationIds.has(event.operationId) || session.finishedOperationIds.has(event.operationId);
          function toolOccurrence(): ToolOccurrenceRelation {
            if (ambiguous) return { state: "unavailable", reason: "ambiguous-operation" };
            if (open === undefined) return { state: "unavailable", reason: "orphan-finish" };
            return { state: "exact", toolOccurrenceId: open };
          }
          const occurrence = toolOccurrence();
          if (open !== undefined && !ambiguous) {
            session.openByOperationId.delete(event.operationId);
            session.finishedOperationIds.add(event.operationId);
          }
          const outputSummary = (projection: Projection, normalize: (value: string) => string) => {
            if (unavailableText !== undefined) return this.text(unavailableText, projection, normalize);
            if (event.output === undefined) return this.text("Output unavailable.", projection, normalize);
            return this.json(event.output, projection, normalize);
          };
          observed = {
            ...base,
            kind: "tool-finish" as const,
            occurrence,
            outcome: event.status,
            outputSummary: field("outputSummary", outputSummary),
          };
        } else {
          const rawLabel = session.openSubagentLabels.get(event.operationId) ?? event.operationId;
          const label = project("label", (projection, normalize) => this.identifier(rawLabel, projection, normalize));
          session.openSubagentLabels.delete(event.operationId);
          const outputSummary = (projection: Projection, normalize: (value: string) => string) => {
            if (unavailableText !== undefined) return this.text(unavailableText, projection, normalize);
            if (event.output === undefined) return this.text(`Subagent ${event.status}.`, projection, normalize);
            return this.json(event.output, projection, normalize);
          };
          observed = {
            ...base,
            kind: "subagent" as const,
            state: event.status,
            label,
            summary: field("summary", outputSummary),
          };
        }
        break;
      case "thinking":
        observed = {
          ...base,
          kind: "thinking-summary" as const,
          summary: field("summary", (projection, normalize) =>
            this.text(unavailableText ?? event.text, projection, normalize),
          ),
        };
        break;
      case "compaction":
        observed = {
          ...base,
          kind: "compaction" as const,
          summary: field("summary", (projection, normalize) =>
            this.text(unavailableText ?? event.reason ?? "Context compacted.", projection, normalize),
          ),
        };
        break;
      case "context.injected":
        observed = {
          ...base,
          kind: "context-injection" as const,
          summary: field("summary", (projection, normalize) =>
            this.text(unavailableText ?? event.text, projection, normalize),
          ),
        };
        break;
      case "skill.loaded":
        observed = {
          ...base,
          kind: "skill-load" as const,
          code: project("code", (projection, normalize) => this.identifier(event.skill, projection, normalize)),
          summary: field("summary", (projection, normalize) =>
            this.text(unavailableText ?? "Skill loaded.", projection, normalize),
          ),
        };
        break;
      case "input.requested": {
        const summary = event.request.prompt ?? event.request.display;
        const promptSummary = (projection: Projection, normalize: (value: string) => string) => {
          if (unavailableText !== undefined) return this.text(unavailableText, projection, normalize);
          if (summary !== undefined) return this.text(summary, projection, normalize);
          if (event.request.input === undefined) return this.text("Input requested.", projection, normalize);
          return this.json(event.request.input, projection, normalize);
        };
        observed = {
          ...base,
          kind: "input-request" as const,
          state: "requested" as const,
          promptSummary: field("promptSummary", promptSummary),
          responseSummary: null,
        };
        break;
      }
      case "error":
        observed = {
          ...base,
          kind: "conversation-error" as const,
          code: requiredIdentifier("stream-error"),
          summary: field("summary", (projection, normalize) =>
            this.text(unavailableText ?? event.message, projection, normalize),
          ),
        };
        break;
    }
    const identicalProjection = normalizeEvaluationText === this.normalizeText;
    const recorded = Object.keys(textTruncations).length === 0 ? observed : { ...observed, textTruncations };
    draft.evaluationItems.push(
      identicalProjection
        ? recorded
        : {
            ...observed,
            ...evaluationFields,
            ...(Object.keys(evaluationTruncations).length === 0 ? {} : { textTruncations: evaluationTruncations }),
          },
    );
    draft.historyLimited ||=
      hasRedaction ||
      hasTruncation ||
      (identicalProjection ? draft.limitations.length > limitationStart : evaluation.limitations.length > 0);
    draft.evaluationEvents.push(this.evaluationEvent(event, normalizeEvaluationText));
    draft.items.push(recorded);
  }

  private evaluationEvent(event: StreamEvent, normalizeText: RedactEvidenceText): StreamEvent {
    return deepFreezeMatcherValue(normalizeMatcherValue(event, normalizeText)) as StreamEvent;
  }

  private toolCommand(
    projection: unknown,
    draft: Pick<TurnDraftState, "limitations">,
    unavailableText: string | undefined,
  ): ObservedToolCommand | undefined {
    if (!isObject(projection)) return undefined;
    if (projection.kind === "not-command") return { kind: "not-command" };
    if (projection.kind !== "command" || !isObject(projection.logical)) return undefined;
    const logical = projection.logical;
    if (logical.normalizer !== LOGICAL_COMMAND_NORMALIZER) return undefined;
    if (logical.state === "available") {
      if (typeof logical.executable !== "string" || !Array.isArray(logical.args)) return undefined;
      const args: unknown[] = Array.from(logical.args);
      if (!args.every((token) => typeof token === "string")) return undefined;
      if (
        logical.normalization !== "identity" &&
        logical.normalization !== "pnpm-exec" &&
        logical.normalization !== "npx"
      ) {
        return undefined;
      }
      if (unavailableText !== undefined) {
        // The whole event is marked redacted or truncated: keep the classification, not the tokens.
        return {
          kind: "command",
          logical: {
            state: "opaque",
            reason: "original-opaque",
            originalReason: unavailableText === "<redacted>" ? "redacted" : "truncated",
          },
        };
      }
      return {
        kind: "command",
        logical: {
          state: "available",
          normalization: logical.normalization,
          executable: this.text(logical.executable, draft, this.normalizeText),
          args: args.map((token) => this.text(token, draft, this.normalizeText)),
        },
      };
    }
    if (logical.state !== "opaque") return undefined;
    if (logical.reason === "original-opaque") {
      return isOriginalOpaqueReason(logical.originalReason)
        ? {
            kind: "command",
            logical: { state: "opaque", reason: "original-opaque", originalReason: logical.originalReason },
          }
        : undefined;
    }
    if (
      logical.reason === "unsupported-wrapper-form" ||
      logical.reason === "ambiguous-wrapper-target" ||
      logical.reason === "multiple-executions"
    ) {
      return { kind: "command", logical: { state: "opaque", reason: logical.reason } };
    }
    return undefined;
  }

  private text(
    value: string,
    draft: Pick<TurnDraftState, "limitations">,
    normalizeText: (value: string) => string,
  ): SafeText {
    const externallyNormalized = normalizeText(value);
    if (externallyNormalized !== value) {
      this.limit(draft, {
        code: "redacted",
        target: "turn-item",
        replacementOrOmittedCount: positive(1),
      });
    }
    const unicode = replaceInvalidSurrogates(externallyNormalized);
    if (unicode.replacements > 0) {
      this.limit(draft, {
        code: "invalid-utf8-replaced",
        target: "turn-item",
        replacementOrOmittedCount: positive(unicode.replacements),
      });
    }
    const controls = stripUnsafeControls(unicode.value);
    if (controls.stripped > 0) {
      this.limit(draft, {
        code: "unsafe-control-stripped",
        target: "turn-item",
        replacementOrOmittedCount: positive(controls.stripped),
      });
    }
    const safe = makeSafeText(controls.value);
    if (safe === undefined) throw new Error("Observed SafeText normalization failed");
    return safe;
  }

  private identifier(
    value: string,
    draft: Pick<TurnDraftState, "limitations">,
    normalizeText: (value: string) => string,
  ): SafeIdentifier {
    const normalized = normalizeText(value);
    if (normalized !== value) {
      this.limit(draft, {
        code: "redacted",
        target: "turn-item",
        replacementOrOmittedCount: positive(1),
      });
    }
    const exact = makeSafeIdentifier(normalized);
    if (exact !== undefined) return exact;
    this.limit(draft, {
      code: "unsupported-input",
      target: "turn-item",
      omittedAtLeast: positive(1),
    });
    return requiredIdentifier("unknown");
  }

  private json(
    value: unknown,
    draft: Pick<TurnDraftState, "limitations">,
    normalizeText: (value: string) => string,
  ): SafeText {
    try {
      const encoded = JSON.stringify(value);
      if (typeof encoded === "string")
        return this.text(encoded, draft, (value) => redactJsonEvidence(value, normalizeText));
    } catch {
      // The typed limitation below carries the lossy boundary.
    }
    this.limit(draft, {
      code: "unsupported-input",
      target: "turn-item",
      omittedAtLeast: positive(1),
    });
    return this.text("Value unavailable.", draft, normalizeText);
  }

  private toolName(
    value: string,
    draft: Pick<TurnDraftState, "limitations">,
    normalizeText: (value: string) => string,
  ): SourceNativeToolName {
    const normalized = normalizeText(value);
    const controls = stripUnsafeControls(replaceInvalidSurrogates(normalized).value).value.replaceAll("\n", " ");
    const retained = retainUtf8Prefix(controls, MAX_SOURCE_NATIVE_TOOL_NAME_BYTES);
    const exact = makeSourceNativeToolName(retained.value);
    if (exact !== undefined) {
      if (normalized !== value) {
        this.limit(draft, {
          code: "redacted",
          target: "turn-item",
          replacementOrOmittedCount: positive(1),
        });
      }
      if (retained.omittedBytes > 0) {
        this.limit(draft, {
          code: "text-truncated",
          target: "turn-item",
          replacementOrOmittedCount: positive(retained.omittedBytes),
        });
      }
      return exact;
    }
    this.limit(draft, {
      code: "unsupported-input",
      target: "turn-item",
      omittedAtLeast: positive(1),
    });
    const fallback = makeSourceNativeToolName("unknown");
    if (fallback === undefined) throw new Error("The fallback tool name must be valid");
    return fallback;
  }

  private limit(draft: Pick<TurnDraftState, "limitations">, limitation: SourceReceiptLimitation): void {
    draft.limitations.push(limitation);
  }
}

function mintEntity<Kind extends "item" | "event" | "tool-occurrence" | "session-scope">(
  kind: Kind,
): import("../record/family/source-receipt/model.ts").ObservabilityEntityIdForKind<Kind> {
  const id = entityIdFromEntropy(kind, randomBytes(16));
  if (id === undefined) throw new Error(`Unable to mint observed ${kind} identity`);
  return id;
}

function positive(value: number): PositiveSafeInteger {
  const result = makePositiveSafeInteger(value);
  if (result === undefined) throw new Error("Observed sequence or count must be positive");
  return result;
}

function requiredIdentifier(value: string): SafeIdentifier {
  const result = makeSafeIdentifier(value);
  if (result === undefined) throw new Error("Fixed observed identifier must be valid");
  return result;
}

function replaceInvalidSurrogates(value: string): { readonly value: string; readonly replacements: number } {
  let normalized = "";
  let replacements = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        normalized += value[index]! + value[index + 1]!;
        index += 1;
      } else {
        normalized += "\ufffd";
        replacements += 1;
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      normalized += "\ufffd";
      replacements += 1;
    } else {
      normalized += value[index]!;
    }
  }
  return { value: normalized, replacements };
}

function stripUnsafeControls(value: string): { readonly value: string; readonly stripped: number } {
  let stripped = 0;
  const normalized = value.replace(/[\u0000-\u0009\u000B-\u001F]/gu, () => {
    stripped += 1;
    return "";
  });
  return { value: normalized, stripped };
}

function retainUtf8Prefix(
  value: string,
  maximumBytes: number,
): { readonly value: string; readonly omittedBytes: number } {
  const total = utf8ByteLength(value);
  if (total <= maximumBytes) return { value, omittedBytes: 0 };
  let retained = "";
  let retainedBytes = 0;
  for (const scalar of value) {
    const bytes = utf8ByteLength(scalar);
    if (retainedBytes + bytes > maximumBytes) break;
    retained += scalar;
    retainedBytes += bytes;
  }
  return { value: retained, omittedBytes: total - retainedBytes };
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeMatcherValue(value: unknown, normalizeText: (value: string) => string): unknown {
  if (typeof value === "string") return normalizeText(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMatcherValue(item, normalizeText));
  }
  const normalized: globalThis.Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // 按键枚举边界：matcher 的字段候选只包含实际提供的值。
    if (item === undefined) continue;
    normalized[key] = normalizeMatcherValue(item, normalizeText);
  }
  return normalized;
}

function deepFreezeMatcherValue<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreezeMatcherValue(item);
  return Object.freeze(value);
}

function isOriginalOpaqueReason(value: unknown): value is OriginalCommandOpaqueReason {
  return (
    value === "redacted" ||
    value === "truncated" ||
    value === "compound-shell" ||
    value === "dynamic-shell" ||
    value === "unsupported-protocol"
  );
}
