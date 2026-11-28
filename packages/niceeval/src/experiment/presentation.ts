import { Result } from "effect";

declare const ExperimentDisplayNameTypeId: unique symbol;

/** A normalized one-line Experiment display value; it never participates in identity, selection, or reuse. */
export type ExperimentDisplayName = string & { readonly [ExperimentDisplayNameTypeId]: true };

/** Author-written presentation fields shared by every Experiment definition input. */
export interface ExperimentPresentationInput {
  /** 一行展示名，长度为 1 到 160 个 UTF-8 字节。请去掉首尾空白和控制字符。省略时显示完整 Experiment ID。 */
  readonly displayName?: string | undefined;
  /** 实验说明，显示在实验列表的详情中。 */
  readonly description?: string | undefined;
}

/** Fields that every machine surface pointing at an Experiment carries together. */
export interface ExperimentOutputFieldsV1 {
  readonly experimentId: string;
  readonly displayName: string;
}

/** Why an explicit displayName was rejected during discovery. */
export interface ExperimentPresentationError {
  readonly code: "experiment-display-name-invalid";
  readonly reason: "empty" | "leading-or-trailing-whitespace" | "control-character" | "too-long" | "invalid-unicode";
}

/** Maximum UTF-8 byte length of an explicit displayName. */
export const EXPERIMENT_DISPLAY_NAME_MAX_BYTES = 160;

const CONTROL_CHARACTER = /[\p{Cc}\u2028\u2029]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const EDGE_WHITESPACE = /^\s|\s$/u;
const encoder = new TextEncoder();

/**
 * Validates and brands an explicit displayName: single-line Unicode scalar text of 1 to 160 UTF-8 bytes
 * without leading or trailing whitespace or control characters.
 */
export function experimentDisplayName(
  input: string,
): Result.Result<ExperimentDisplayName, ExperimentPresentationError> {
  const reject = (reason: ExperimentPresentationError["reason"]) =>
    Result.fail({ code: "experiment-display-name-invalid" as const, reason });
  if (LONE_SURROGATE.test(input)) return reject("invalid-unicode");
  if (input.length === 0) return reject("empty");
  if (CONTROL_CHARACTER.test(input)) return reject("control-character");
  if (EDGE_WHITESPACE.test(input)) return reject("leading-or-trailing-whitespace");
  if (encoder.encode(input).byteLength > EXPERIMENT_DISPLAY_NAME_MAX_BYTES) return reject("too-long");
  return Result.succeed(input as ExperimentDisplayName);
}

/** The only fallback for a missing displayName: the complete Experiment ID, never a shortened path segment. */
export function fallbackExperimentDisplayName(experimentId: string): ExperimentDisplayName {
  return experimentId as ExperimentDisplayName;
}

/** Human pairing used by dry plans, running rows and completion summaries; the ID is never shortened. */
export function experimentDisplayLabel(presentation: ExperimentOutputFieldsV1): string {
  return presentation.displayName === presentation.experimentId
    ? presentation.experimentId
    : `${presentation.displayName} [${presentation.experimentId}]`;
}

export function experimentOutputFields(
  experimentId: string,
  names: ReadonlyMap<string, string>,
): ExperimentOutputFieldsV1 {
  return { experimentId, displayName: names.get(experimentId) ?? experimentId };
}

export function sharedExperimentDisplayNames(runs: readonly ExperimentOutputFieldsV1[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const { experimentId, displayName } of runs) {
    const current = names.get(experimentId);
    names.set(experimentId, current === undefined || current === displayName ? displayName : experimentId);
  }
  return names;
}

export class InvalidExperimentDisplayName extends TypeError {
  readonly code = "experiment-display-name-invalid";
}
