/** Finite plain JSON accepted by the generic execution-trace boundary. */
export type TraceJson =
  | null
  | boolean
  | number
  | string
  | readonly TraceJson[]
  | { readonly [key: string]: TraceJson };

export interface ExecutionTraceLimitation {
  readonly code: string;
  readonly message: string;
}

export interface ExecutionTraceScope {
  readonly scopeId: string;
  readonly label: string;
  readonly boundary: TraceJson;
}

export interface ExecutionTraceSource {
  readonly id: string;
  readonly eventId?: string;
  readonly sequence?: number;
}

export interface ExecutionTraceActor {
  readonly id: string;
  readonly label?: string;
}

export interface ExecutionTraceTime {
  readonly clockId: string;
  readonly value: number;
  readonly unit: string;
}

export type ExecutionTraceLink =
  | { readonly relation: string; readonly targetKey: string }
  | {
      readonly relation: string;
      readonly unresolved: {
        readonly sourceEventId: string;
        readonly reason: string;
      };
    };

export interface ExecutionTraceEvidence {
  readonly key: string;
  readonly label: string;
  readonly artifactId: string;
  readonly pointer: string;
}

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
      readonly speaker?: string;
      readonly text: string;
    }
  | {
      readonly kind: "fields";
      readonly fields: readonly {
        readonly label: string;
        readonly value: string | number | boolean | null;
      }[];
    }
  | { readonly kind: "code"; readonly language?: string; readonly text: string }
  | { readonly kind: "image"; readonly artifactId: string; readonly alt: string };

/**
 * One Adapter-owned domain event. `Type` and `Payload` preserve a caller's
 * discriminated union without requiring NiceEval to execute its domain parser.
 */
export interface ExecutionTraceEvent<
  out Type extends string = string,
  out Payload extends TraceJson = TraceJson,
> {
  readonly key: string;
  readonly type: Type;
  readonly source: ExecutionTraceSource;
  readonly actor?: ExecutionTraceActor;
  readonly time?: ExecutionTraceTime;
  readonly summary: string;
  readonly payload?: Payload;
  readonly links?: readonly ExecutionTraceLink[];
  readonly evidence?: readonly ExecutionTraceEvidence[];
  readonly scopeMemberships?: readonly ExecutionTraceScopeMembership[];
  /** Optional human-readable blocks; omitted means the event has no display. */
  readonly display?: readonly ExecutionDisplayBlock[];
}

export interface ExecutionTraceInput<
  out Event extends ExecutionTraceEvent = ExecutionTraceEvent,
> {
  readonly traceId: string;
  readonly schema: { readonly id: string };
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly ExecutionTraceLimitation[];
  };
  readonly scopes: readonly ExecutionTraceScope[];
  readonly events: readonly Event[];
}

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
