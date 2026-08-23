import type { SourceReceiptCollection, SourceReceiptLimitation } from "../../record/family/source-receipt/index.ts";
import {
  compareObservabilityLimitation,
  limitationTarget,
  makeNonNegativeSafeInteger,
  makePositiveSafeInteger,
  type Collection,
  type CollectionStage,
  type CollectionTarget,
  type CommandId,
  type ItemId,
  type NonNegativeSafeInteger,
  type ObservabilityEntityKind,
  type ObservabilityLimitation,
  type PositiveSafeInteger,
} from "../../record/family/source-receipt/model.ts";

/**
 * The Runner never exposes raw provider frames to the Record layer. These
 * errors therefore carry only an internal stable code and entity kind.
 */
export type RunnerObservabilityProducerError =
  | {
      readonly code: "runner-observability-entity-id-invalid";
      readonly kind: ObservabilityEntityKind;
    }
  | {
      readonly code: "runner-observability-capture-seal-invalid";
      readonly owner: "attempt" | "run";
    }
  | {
      readonly code: "runner-observability-capture-missing";
    }
  | {
    readonly code: "runner-observability-command-registration-invalid";
    };

export function isRunnerObservabilityProducerError(
  value: unknown,
): value is RunnerObservabilityProducerError {
  if (typeof value !== "object" || value === null || !("code" in value)) return false;
  const code = value.code;
  switch (code) {
    case "runner-observability-capture-missing":
    case "runner-observability-command-registration-invalid":
      return true;
    case "runner-observability-capture-seal-invalid":
      return "owner" in value && (value.owner === "attempt" || value.owner === "run");
    case "runner-observability-entity-id-invalid":
      return "kind" in value && typeof value.kind === "string";
    default:
      return false;
  }
}

export function producerEntityIdInvalid(
  kind: ObservabilityEntityKind,
): RunnerObservabilityProducerError {
  return Object.freeze({
    code: "runner-observability-entity-id-invalid" as const,
    kind,
  });
}
export function producerCaptureSealInvalid(
  owner: "attempt" | "run",
): RunnerObservabilityProducerError {
  return Object.freeze({
    code: "runner-observability-capture-seal-invalid" as const,
    owner,
  });
}

export function producerCaptureMissing(): RunnerObservabilityProducerError {
  return Object.freeze({ code: "runner-observability-capture-missing" as const });
}

export function producerCommandRegistrationInvalid(): RunnerObservabilityProducerError {
  return Object.freeze({ code: "runner-observability-command-registration-invalid" as const });
}

export function requiredPositive(value: number): PositiveSafeInteger {
  const positive = makePositiveSafeInteger(value);
  if (positive !== undefined) return positive;
  const fallback = makePositiveSafeInteger(1);
  if (fallback === undefined) throw new Error("One must be a positive safe integer");
  return fallback;
}

export function requiredNonNegative(value: number): NonNegativeSafeInteger {
  const nonNegative = makeNonNegativeSafeInteger(value);
  if (nonNegative !== undefined) return nonNegative;
  const fallback = makeNonNegativeSafeInteger(0);
  if (fallback === undefined) throw new Error("Zero must be a non-negative safe integer");
  return fallback;
}

/** Coalesces and canonically orders the closed durable limitation union. */
export class RunnerCollectionLimitations {
  private readonly captureFailed = new Map<string, {
    readonly stage: CollectionStage;
    readonly target: CollectionTarget;
  }>();
  private readonly captureInterrupted = new Map<string, {
    readonly stage: CollectionStage;
    readonly target: CollectionTarget;
  }>();
  private readonly unsupported = new Map<CollectionTarget, number>();
  private readonly redacted = new Map<CollectionTarget, number>();
  private readonly caps = new Map<CollectionTarget, {
    readonly retained: number;
    readonly omittedAtLeast: number;
  }>();
  private readonly textTruncations: ObservabilityLimitation[] = [];

  addCaptureFailed(stage: CollectionStage, target: CollectionTarget): void {
    this.captureFailed.set(`${stage}\u0000${target}`, Object.freeze({ stage, target }));
  }

  addCaptureInterrupted(stage: CollectionStage, target: CollectionTarget): void {
    this.captureInterrupted.set(`${stage}\u0000${target}`, Object.freeze({ stage, target }));
  }

  addUnsupported(target: CollectionTarget, omittedAtLeast = 1): void {
    this.unsupported.set(target, (this.unsupported.get(target) ?? 0) + omittedAtLeast);
  }

  addRedacted(target: CollectionTarget, replacements = 1): void {
    this.redacted.set(target, (this.redacted.get(target) ?? 0) + replacements);
  }

  addCap(target: CollectionTarget, retained: number, omittedAtLeast = 1): void {
    const current = this.caps.get(target);
    this.caps.set(target, Object.freeze({
      retained: Math.max(retained, current?.retained ?? 0),
      omittedAtLeast: (current?.omittedAtLeast ?? 0) + omittedAtLeast,
    }));
  }

  addConversationTextTruncated(
    itemId: ItemId,
    retainedBytes: NonNegativeSafeInteger,
    omittedBytes: PositiveSafeInteger,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "text-truncated" as const,
      target: "conversation-text" as const,
      itemId,
      retainedBytes,
      omittedBytes,
    }));
  }

  addCommandManifestTextTruncated(
    commandId: CommandId,
    retainedBytes: NonNegativeSafeInteger,
    omittedBytes: PositiveSafeInteger,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "text-truncated" as const,
      target: "command-manifest" as const,
      commandId,
      retainedBytes,
      omittedBytes,
    }));
  }

  addCommandStreamTruncated(
    commandId: CommandId,
    stream: "stdout" | "stderr",
    retainedBytes: NonNegativeSafeInteger,
    omittedBytes: PositiveSafeInteger,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "stream-truncated" as const,
      commandId,
      stream,
      retainedBytes,
      omittedBytes,
    }));
  }

  addUnsafeCommandControlStripped(
    commandId: CommandId,
    stream: "stdout" | "stderr",
    strippedCount: number,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "unsafe-control-stripped" as const,
      commandId,
      stream,
      strippedCount: requiredPositive(strippedCount),
    }));
  }

  collection(): Collection {
    const limitations: ObservabilityLimitation[] = [];
    for (const { stage, target } of this.captureFailed.values()) {
      limitations.push(Object.freeze({
        code: "capture-failed" as const,
        stage,
        target,
      }));
    }
    for (const { stage, target } of this.captureInterrupted.values()) {
      limitations.push(Object.freeze({
        code: "capture-interrupted" as const,
        stage,
        target,
      }));
    }
    for (const [target, omittedAtLeast] of this.unsupported) {
      limitations.push(Object.freeze({
        code: "unsupported-input" as const,
        target,
        omittedAtLeast: requiredPositive(omittedAtLeast),
      }));
    }
    for (const [target, replacements] of this.redacted) {
      limitations.push(Object.freeze({
        code: "redacted" as const,
        target,
        replacementCount: requiredPositive(replacements),
      }));
    }
    for (const [target, cap] of this.caps) {
      limitations.push(Object.freeze({
        code: "collection-cap-reached" as const,
        target,
        retained: requiredNonNegative(cap.retained),
        omittedAtLeast: requiredPositive(cap.omittedAtLeast),
      }));
    }
    limitations.push(...this.textTruncations);
    limitations.sort(compareObservabilityLimitation);
    if (limitations.length === 0) {
      return Object.freeze({
        state: "complete" as const,
        limitations: Object.freeze([]) as readonly [],
      });
    }
    const [first, ...rest] = limitations;
    if (first === undefined) throw new Error("A non-empty limitation list needs a first entry");
    return Object.freeze({
      state: "partial" as const,
      limitations: Object.freeze([first, ...rest]) as readonly [
        ObservabilityLimitation,
        ...ObservabilityLimitation[],
      ],
    });
  }
}

type SourceStage =
  | "adapter"
  | "sandbox-wrapper"
  | "runner-clock"
  | "runner-diagnostic-sink";

function sourceTarget(target: CollectionTarget): SourceReceiptLimitation["target"] {
  switch (target) {
    case "conversation-item":
    case "conversation-text": return "turn-item";
    case "usage-observation": return "usage-observation";
    case "command-manifest": return "command";
    case "command-stdout": return "stdout";
    case "command-stderr": return "stderr";
    case "timing-interval": return "activity";
    case "diagnostic": return "diagnostic";
  }
}

function sourceLimitation(
  limitation: ObservabilityLimitation,
  stage: SourceStage,
): SourceReceiptLimitation {
  const target = sourceTarget(limitationTarget(limitation));
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return Object.freeze({ code: limitation.code, stage, target });
    case "collection-cap-reached":
    case "unsupported-input":
      return Object.freeze({ code: limitation.code, target, omittedAtLeast: limitation.omittedAtLeast });
    case "text-truncated":
      return Object.freeze({ code: "text-truncated", target, replacementOrOmittedCount: limitation.omittedBytes });
    case "redacted":
      return Object.freeze({ code: "redacted", target, replacementOrOmittedCount: limitation.replacementCount });
    case "stream-truncated":
      return Object.freeze({ code: "text-truncated", target, replacementOrOmittedCount: limitation.omittedBytes });
    case "invalid-utf8-replaced":
      return Object.freeze({ code: "invalid-utf8-replaced", target, replacementOrOmittedCount: limitation.replacementCount });
    case "unsafe-control-stripped":
      return Object.freeze({ code: "unsafe-control-stripped", target, replacementOrOmittedCount: limitation.strippedCount });
  }
}

export function sourceCollection(
  sources: readonly { readonly collection: Collection; readonly stage: SourceStage }[],
): SourceReceiptCollection {
  const limitations = sources.flatMap(({ collection, stage }) =>
    collection.limitations.map((limitation) => sourceLimitation(limitation, stage))
  );
  const byKey = new Map(limitations.map((limitation) => [JSON.stringify(limitation), limitation] as const));
  const canonical = [...byKey.entries()]
    .sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1)
    .map(([, limitation]) => limitation);
  if (canonical.length === 0) {
    return Object.freeze({
      state: "complete" as const,
      limitations: Object.freeze([]) as readonly [],
    });
  }
  const [first, ...rest] = canonical;
  if (first === undefined) throw new Error("A partial source collection needs a limitation");
  return Object.freeze({
    state: "partial" as const,
    limitations: Object.freeze([first, ...rest]) as readonly [
      SourceReceiptLimitation,
      ...SourceReceiptLimitation[],
    ],
  });
}
