/** Finite plain JSON accepted by the generic execution-trace boundary. */
export type TraceJson = null | boolean | number | string | readonly TraceJson[] | { readonly [key: string]: TraceJson };

/** Explains a known execution-trace coverage gap; absence of an event must not be interpreted as proof when coverage is limited. */
export interface ExecutionTraceLimitation {
  readonly code: string;
  readonly message: string;
}

/** Describes the coverage of the submitted execution trace. */
export interface ExecutionTraceCollection {
  readonly state: "complete" | "partial";
  readonly limitations: readonly ExecutionTraceLimitation[];
}

/** Identifies an externally retained original without granting access to it. */
export interface ExecutionTraceArchive {
  readonly system: string;
  readonly locator: TraceJson;
  readonly sha256?: string;
  readonly byteLength?: number;
}

/** Defines an application trace boundary with a stable scope ID; membership is declared separately for each event. */
export interface ExecutionTraceScope {
  readonly scopeId: string;
  readonly label: string;
  readonly boundary: TraceJson;
}

/** Preserves an application's original source and optional event sequence; it is separate from the stored event ID returned by recordTrace. */
export interface ExecutionTraceSource {
  readonly id: string;
  readonly eventId?: string | undefined;
  readonly sequence?: number | undefined;
}

/** Identifies a participant within a submitted execution trace; labels are display text and must not replace stable actor IDs. */
export interface ExecutionTraceActor {
  readonly id: string;
  readonly label?: string | undefined;
}

/** Carries a timestamp with its explicit clock and unit; values from different clocks must not be ordered as if they shared a timebase. */
export interface ExecutionTraceTime {
  readonly clockId: string;
  readonly value: number;
  readonly unit: string;
}

/** Relates an event to another event key or records an unresolved source reference; unresolved links must not be fabricated as resolved events. */
export type ExecutionTraceLink =
  | { readonly relation: string; readonly targetKey: string }
  | {
      readonly relation: string;
      readonly unresolved: {
        readonly sourceEventId: string;
        readonly reason: string;
      };
    };

/** Links a trace event to an attached artifact and pointer; attach the artifact before referencing its receipt ID. */
export interface ExecutionTraceEvidence {
  readonly key: string;
  readonly label: string;
  readonly artifactId: string;
  readonly pointer: string;
}

/** States whether an event belongs to a declared trace scope; unknown membership is distinct from exclusion. */
export interface ExecutionTraceScopeMembership {
  readonly scopeId: string;
  readonly state: "included" | "excluded" | "unknown";
}

/** One closed, human-readable display block sealed with its event. */
export type ExecutionDisplayBlock =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "message";
      readonly role: "user" | "assistant" | "system" | "other";
      readonly speaker?: string | undefined;
      readonly text: string;
    }
  | {
      readonly kind: "fields";
      readonly fields: readonly {
        readonly label: string;
        readonly value: string | number | boolean | null;
      }[];
    }
  | { readonly kind: "code"; readonly language?: string | undefined; readonly text: string }
  | { readonly kind: "image"; readonly artifactId: string; readonly alt: string };

/**
 * One Adapter-owned domain event. `Type` and `Payload` preserve a caller's
 * discriminated union without requiring NiceEval to execute its domain parser.
 */
export interface ExecutionTraceEvent<out Type extends string = string, out Payload extends TraceJson = TraceJson> {
  readonly key: string;
  readonly type: Type;
  readonly source: ExecutionTraceSource;
  readonly actor?: ExecutionTraceActor | undefined;
  readonly time?: ExecutionTraceTime | undefined;
  readonly summary: string;
  readonly payload?: Payload | undefined;
  readonly links?: readonly ExecutionTraceLink[] | undefined;
  readonly evidence?: readonly ExecutionTraceEvidence[] | undefined;
  readonly scopeMemberships?: readonly ExecutionTraceScopeMembership[] | undefined;
  /** Optional human-readable blocks; omitted means the event has no display. */
  readonly display?: readonly ExecutionDisplayBlock[] | undefined;
}

/** Submits application-owned events, scopes and completeness evidence; a partial collection must retain its limitations. */
export interface ExecutionTraceInput<out Event extends ExecutionTraceEvent = ExecutionTraceEvent> {
  readonly traceId: string;
  readonly schema: { readonly id: string };
  readonly archive?: ExecutionTraceArchive;
  readonly collection: ExecutionTraceCollection;
  readonly scopes: readonly ExecutionTraceScope[];
  readonly events: readonly Event[];
}

/** Describes one streamed scope, event, or producer declaration of completeness. */
export type ExecutionTraceStreamItem<Event extends ExecutionTraceEvent = ExecutionTraceEvent> =
  | { readonly kind: "scope"; readonly scope: ExecutionTraceScope }
  | { readonly kind: "event"; readonly event: Event }
  | { readonly kind: "end"; readonly collection: ExecutionTraceCollection };

/** Supplies the producer factory and optional caller cancellation for one trace submission. */
export interface ExecutionTraceStreamInput<out Event extends ExecutionTraceEvent = ExecutionTraceEvent> {
  readonly traceId: string;
  readonly schema: { readonly id: string };
  readonly archive?: ExecutionTraceArchive;
  readonly events: {
    readonly stream: (signal: AbortSignal) => AsyncIterable<ExecutionTraceStreamItem<Event>>;
  };
  readonly signal?: AbortSignal;
}

/** Explains why the framework stopped pulling before receiving an end item. */
export type ExecutionTraceStreamCutReason = "producer-error" | "unterminated" | "aborted" | "admission-closed";

/** Summarizes the retained items and completeness of an accepted streamed trace. */
export interface ExecutionTraceStreamReceipt {
  readonly state: "accepted";
  readonly traceId: string;
  readonly ending:
    | { readonly kind: "declared" }
    | { readonly kind: "cut"; readonly reason: ExecutionTraceStreamCutReason; readonly droppedItems: number };
  readonly collection: ExecutionTraceCollection;
  readonly scopeCount: number;
  readonly eventCount: number;
  readonly evidenceCount: number;
}

/** Maps accepted application event and evidence keys to stored IDs; retain the receipt for later navigation rather than guessing IDs. */
export interface ExecutionTraceReceipt {
  readonly state: "accepted";
  readonly traceId: string;
  readonly events: readonly {
    readonly key: string;
    readonly eventId: string;
    readonly evidence: readonly {
      readonly key: string;
      readonly evidenceId: string;
    }[];
  }[];
}
