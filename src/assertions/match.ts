// Match 内核：纯候选比较、三态结果与领域 matcher。
//
// 这里不登记 Assertion，也不决定 Verdict / Score。调用方先冻结 subject，再把同一
// candidate 交给本模块；因此组合 matcher 不会自行重读证据，也不会把 evaluator defect
// 折成 mismatch 或 unavailable。

import type { StandardSchemaV1 as StandardSchema } from "@standard-schema/spec";

import type {
  CommandProjection,
  LogicalToolOccurrence,
} from "../o11y/types.ts";
import { matchesJson } from "../shared/json-match.ts";
import type { JsonMatch, JsonValue } from "../shared/types.ts";
import { stripComments } from "../util.ts";

export type MatchDomain = "value" | "tool" | "event";

type MatchPathSegment = string | number;

/** 可序列化的候选诊断；组合 matcher 用 children 保留声明顺序与嵌套位置。 */
export interface MatchDiagnostic {
  readonly code: string;
  readonly message: string;
  /** 相对当前 matcher 的路径；组合节点的 child index 也由 children 明确给出。 */
  readonly path: readonly MatchPathSegment[];
  readonly expected?: string;
  readonly received?: string;
  readonly reason?: string;
  readonly locator?:
    | { readonly kind: "json-pointer"; readonly pointer: string }
    | { readonly kind: "tool-occurrence"; readonly id: string };
  readonly children?: readonly MatchDiagnosticChild[];
}

export interface MatchDiagnosticChild {
  readonly index: number;
  readonly label?: string;
  readonly state: MatchEvaluationState;
  readonly diagnostic?: MatchDiagnostic;
}

export type MatchEvaluationState = "matched" | "mismatched" | "unavailable";

/** 一个单候选 matcher 的内部三态结果。 */
export type BooleanMatchEvaluation<R> =
  | {
      readonly state: "matched";
      /** 永远是传入 candidate 本身，只是在类型层收窄。 */
      readonly value: R;
      readonly diagnostic?: MatchDiagnostic;
    }
  | {
      readonly state: "mismatched";
      readonly diagnostic: MatchDiagnostic;
    }
  | {
      readonly state: "unavailable";
      readonly reason: string;
      readonly diagnostic: MatchDiagnostic;
    };

// 这些 symbol 不导出。外部作者无法构造看似可消费的 Match；输入 variance 与 refinement
// variance 也保持分离，ScoreMatch 不会伪造一个没有含义的输出 refinement。
const matchInputBrand: unique symbol = Symbol("niceeval.match.input");
const matchRefinementBrand: unique symbol = Symbol("niceeval.match.refinement");
const matchEvaluatorBrand: unique symbol = Symbol("niceeval.match.evaluator");
const positiveWitnessBrand: unique symbol = Symbol("niceeval.match.positive-witness");
const thresholdedScoreMatchBrand: unique symbol = Symbol("niceeval.thresholdedScoreMatch");
const assertionEventIdentityBrand: unique symbol = Symbol("niceeval.assertionEventIdentity");
const assertionEventPositionBrand: unique symbol = Symbol("niceeval.assertionEventPosition");
const toolOccurrenceIdentityBrand: unique symbol = Symbol("niceeval.toolOccurrenceIdentity");
const matchBrands = new WeakSet<object>();
const thresholdedScoreMatches = new WeakMap<object, {
  readonly match: ScoreMatch<unknown>;
  readonly threshold: number;
}>();

export interface Match<in T, D extends MatchDomain> {
  readonly domain: D;
  readonly name: string;
  readonly [matchInputBrand]: (candidate: T) => void;
  readonly [matchEvaluatorBrand]: (candidate: T) => Promise<unknown>;
}

export interface BooleanMatch<in T, out R extends T, D extends MatchDomain = "value"> extends Match<T, D> {
  readonly kind: "boolean";
  readonly [matchRefinementBrand]: () => R;
}

export interface ScoreMatch<in T> extends Match<T, "value"> {
  readonly kind: "score";
  atLeast(threshold: number): ThresholdedScoreMatch<T>;
}

export interface ThresholdedScoreMatch<in T> {
  readonly kind: "thresholded-score-match";
  readonly [thresholdedScoreMatchBrand]: (candidate: T) => void;
}

export type ValueMatch<T, R extends T = T> = BooleanMatch<T, R, "value"> | ScoreMatch<T>;

export type LogicalCommandOccurrence = LogicalToolOccurrence & {
  readonly command: Extract<CommandProjection, { readonly kind: "command" }>;
};

export type ToolMatch<R extends LogicalToolOccurrence = LogicalToolOccurrence> = BooleanMatch<
  LogicalToolOccurrence,
  R,
  "tool"
>;

export type AssertionEventIdentity = string & { readonly [assertionEventIdentityBrand]: true };
export type ToolOccurrenceIdentity = string & { readonly [toolOccurrenceIdentityBrand]: true };

export interface AssertionEventPosition {
  readonly turnOrdinal: number;
  readonly eventOrdinal: number;
  readonly [assertionEventPositionBrand]: true;
}

export interface AssertionToolReference {
  readonly id: ToolOccurrenceIdentity;
  readonly name: string;
}

export type AssertionEvent =
  | {
      readonly id: AssertionEventIdentity;
      readonly position: AssertionEventPosition;
      readonly type: "message";
      readonly role: "assistant" | "user";
      readonly text: string;
    }
  | {
      readonly id: AssertionEventIdentity;
      readonly position: AssertionEventPosition;
      readonly type: "operation.started";
      readonly tool: AssertionToolReference;
    }
  | {
      readonly id: AssertionEventIdentity;
      readonly position: AssertionEventPosition;
      readonly type: "operation.finished";
      readonly tool: AssertionToolReference;
      readonly status: "completed" | "failed" | "rejected";
    };

export type MatchableEvent = AssertionEvent;
export type EventMatch<R extends AssertionEvent = AssertionEvent> = BooleanMatch<AssertionEvent, R, "event">;

const assertionEventOccurrences = new WeakMap<object, LogicalToolOccurrence>();

export type RefinementOf<M> = M extends BooleanMatch<infer _T, infer R, infer _D> ? R : never;
export type RefinementIntersection<M extends readonly unknown[]> = M extends readonly [infer Head, ...infer Tail]
  ? RefinementOf<Head> & RefinementIntersection<Tail>
  : unknown;

interface InternalMatch {
  readonly domain: MatchDomain;
  readonly name: string;
  readonly kind: "boolean" | "score";
  readonly [matchEvaluatorBrand]: (candidate: unknown) => Promise<unknown>;
  readonly [positiveWitnessBrand]?: true;
}

interface CreateBooleanMatchOptions {
  readonly positiveWitness?: true;
}

function isRecord(value: unknown): value is globalThis.Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object";
}

function diagnostic(
  code: string,
  message: string,
  options: Omit<MatchDiagnostic, "code" | "message" | "path"> & { readonly path?: readonly MatchPathSegment[] } = {},
): MatchDiagnostic {
  return Object.freeze({
    code,
    message,
    path: Object.freeze([...(options.path ?? [])]),
    ...(options.expected === undefined ? {} : { expected: options.expected }),
    ...(options.received === undefined ? {} : { received: options.received }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.locator === undefined ? {} : { locator: options.locator }),
    ...(options.children === undefined ? {} : { children: Object.freeze([...options.children]) }),
  });
}

function matched<R>(value: R, detail?: MatchDiagnostic): BooleanMatchEvaluation<R> {
  return Object.freeze({ state: "matched" as const, value, ...(detail === undefined ? {} : { diagnostic: detail }) });
}

function mismatched<R = never>(detail: MatchDiagnostic): BooleanMatchEvaluation<R> {
  return Object.freeze({ state: "mismatched" as const, diagnostic: detail });
}

function unavailable<R = never>(reason: string, detail: MatchDiagnostic): BooleanMatchEvaluation<R> {
  return Object.freeze({ state: "unavailable" as const, reason, diagnostic: detail });
}

function assertDiagnostic(value: unknown, label: string): asserts value is MatchDiagnostic {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string" || !Array.isArray(value.path)) {
    throw new TypeError(`${label} returned an invalid diagnostic`);
  }
}

function assertBooleanEvaluation<R>(value: unknown, label: string): BooleanMatchEvaluation<R> {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new TypeError(`${label} returned an invalid boolean matcher result`);
  }

  if (value.state === "matched") {
    if (!("value" in value)) throw new TypeError(`${label} returned a matched result without the original candidate`);
    return value as BooleanMatchEvaluation<R>;
  }

  if (value.state === "mismatched") {
    assertDiagnostic(value.diagnostic, label);
    return value as BooleanMatchEvaluation<R>;
  }

  if (value.state === "unavailable") {
    if (typeof value.reason !== "string" || value.reason.length === 0) {
      throw new TypeError(`${label} returned unavailable without a reason`);
    }
    assertDiagnostic(value.diagnostic, label);
    return value as BooleanMatchEvaluation<R>;
  }

  throw new TypeError(`${label} returned an unknown matcher state`);
}

function internalMatchOf(value: unknown, label: string): InternalMatch {
  if (!isRecord(value) || !matchBrands.has(value)) {
    throw new TypeError(`${label} must be a Match created by niceeval/expect`);
  }
  const match = value as unknown as InternalMatch;
  if (
    (match.domain !== "value" && match.domain !== "tool" && match.domain !== "event") ||
    (match.kind !== "boolean" && match.kind !== "score") ||
    typeof match.name !== "string" ||
    typeof match[matchEvaluatorBrand] !== "function"
  ) {
    throw new TypeError(`${label} must be a Match created by niceeval/expect`);
  }
  return match;
}

/** @internal Runtime brand guard used by the context overload dispatcher. */
export function isManagedMatch(value: unknown): boolean {
  return isRecord(value) && matchBrands.has(value);
}

/** @internal Reject Match-shaped raw subjects instead of silently treating them as ordinary values. */
export function looksLikeMatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.domain === "value" || value.domain === "tool" || value.domain === "event") &&
    (value.kind === "boolean" || value.kind === "score") && typeof value.name === "string";
}

/** @internal Runtime brand guard for ScoreMatch.atLeast(). */
export function isManagedThresholdedScoreMatch(value: unknown): value is ThresholdedScoreMatch<unknown> {
  return isRecord(value) && thresholdedScoreMatches.has(value);
}

/** @internal Reserve threshold-view-shaped raw inputs at the authoring boundary. */
export function looksLikeThresholdedScoreMatch(value: unknown): boolean {
  return isRecord(value) && value.kind === "thresholded-score-match";
}

/** @internal Resolve a threshold view without evaluating its underlying Match. */
export function thresholdedScoreMatchValue(value: unknown): {
  readonly match: ScoreMatch<unknown>;
  readonly threshold: number;
} {
  const resolved = isRecord(value) ? thresholdedScoreMatches.get(value) : undefined;
  if (resolved === undefined) {
    throw new TypeError("value must be a threshold view created by ScoreMatch.atLeast()");
  }
  return resolved;
}

/** @internal The value-side consumer accepts only a real, value-domain Match. */
export function assertManagedValueMatch(
  value: unknown,
  label = "match",
): BooleanMatch<unknown, unknown, "value"> | ScoreMatch<unknown> {
  const match = internalMatchOf(value, label);
  if (match.domain !== "value") throw new TypeError(`${label} must be a value-domain Match`);
  return value as BooleanMatch<unknown, unknown, "value"> | ScoreMatch<unknown>;
}

function assertBooleanMatch(value: unknown, label: string, domain?: MatchDomain): InternalMatch {
  const match = internalMatchOf(value, label);
  if (match.kind !== "boolean") throw new TypeError(`${label} must be a BooleanMatch`);
  if (domain !== undefined && match.domain !== domain) {
    throw new TypeError(`${label} must have ${domain} domain, received ${match.domain}`);
  }
  return match;
}

function createBooleanMatch<T, R extends T, D extends MatchDomain>(
  domain: D,
  name: string,
  evaluate: (candidate: T) => BooleanMatchEvaluation<R> | Promise<BooleanMatchEvaluation<R>>,
  options: CreateBooleanMatchOptions = {},
): BooleanMatch<T, R, D> {
  const result = {
    domain,
    name,
    kind: "boolean" as const,
    [matchInputBrand]: (_candidate: T) => undefined,
    [matchRefinementBrand]: () => undefined as unknown as R,
    [matchEvaluatorBrand]: async (candidate: T) => evaluate(candidate),
    ...(options.positiveWitness === true ? { [positiveWitnessBrand]: true as const } : {}),
  };
  const match = Object.freeze(result) as BooleanMatch<T, R, D>;
  matchBrands.add(match);
  return match;
}

function createScoreMatch<T>(
  name: string,
  evaluate: (candidate: T) => number | Promise<number>,
): ScoreMatch<T> {
  let match: ScoreMatch<T>;
  const result = {
    domain: "value" as const,
    name,
    kind: "score" as const,
    [matchInputBrand]: (_candidate: T) => undefined,
    [matchEvaluatorBrand]: async (candidate: T) => evaluate(candidate),
    atLeast(threshold: number) {
      assertUnitThreshold(threshold, "ScoreMatch.atLeast() threshold");
      const view: ThresholdedScoreMatch<T> = {
        kind: "thresholded-score-match",
        [thresholdedScoreMatchBrand]: (_candidate: T) => undefined,
      };
      thresholdedScoreMatches.set(view, { match: match as ScoreMatch<unknown>, threshold });
      return Object.freeze(view);
    },
  };
  match = Object.freeze(result) as ScoreMatch<T>;
  matchBrands.add(match);
  return match;
}

function assertUnitThreshold(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a finite number in [0, 1]`);
  }
}

function freezeEventPosition(turnOrdinal: number, eventOrdinal: number): AssertionEventPosition {
  return Object.freeze({ turnOrdinal, eventOrdinal }) as AssertionEventPosition;
}

function assertionEventId(
  session: string,
  turn: string,
  turnOrdinal: number,
  eventOrdinal: number,
): AssertionEventIdentity {
  return JSON.stringify([
    "niceeval.assertion-event/1",
    session,
    turn,
    turnOrdinal,
    eventOrdinal,
  ]) as AssertionEventIdentity;
}

/** @internal Project a raw message into the closed assertion-event surface. */
export function makeAssertionMessageEvent(input: {
  readonly session: string;
  readonly turn: string;
  readonly turnOrdinal: number;
  readonly eventOrdinal: number;
  readonly role: "assistant" | "user";
  readonly text: string;
}): Extract<AssertionEvent, { readonly type: "message" }> {
  return Object.freeze({
    id: assertionEventId(input.session, input.turn, input.turnOrdinal, input.eventOrdinal),
    position: freezeEventPosition(input.turnOrdinal, input.eventOrdinal),
    type: "message" as const,
    role: input.role,
    text: input.text,
  });
}

/** @internal Project a correlated tool lifecycle row without exposing raw adapter fields. */
export function makeAssertionToolEvent(input: {
  readonly session: string;
  readonly turn: string;
  readonly turnOrdinal: number;
  readonly eventOrdinal: number;
  readonly type: "operation.started" | "operation.finished";
  readonly occurrence: LogicalToolOccurrence;
  readonly status?: "completed" | "failed" | "rejected";
}): Extract<AssertionEvent, { readonly type: "operation.started" | "operation.finished" }> {
  const base = {
    id: assertionEventId(input.session, input.turn, input.turnOrdinal, input.eventOrdinal),
    position: freezeEventPosition(input.turnOrdinal, input.eventOrdinal),
    tool: Object.freeze({
      id: input.occurrence.id as ToolOccurrenceIdentity,
      name: input.occurrence.name.canonical ?? input.occurrence.name.original,
    }),
  };
  const event = input.type === "operation.started"
    ? Object.freeze({ ...base, type: "operation.started" as const })
    : Object.freeze({
        ...base,
        type: "operation.finished" as const,
        status: input.status ?? (() => {
          throw new TypeError("operation.finished assertion event requires status");
        })(),
      });
  assertionEventOccurrences.set(event, input.occurrence);
  return event;
}

/** @internal Retrieve the correlated occurrence for eventMatch(tool). */
export function assertionEventOccurrence(event: AssertionEvent): LogicalToolOccurrence | undefined {
  return assertionEventOccurrences.get(event);
}

/** 供 Assertion runtime / scope owner 消费 BooleanMatch；普通作者面不会导出此 evaluator。 */
export async function evaluateBooleanMatch<T, R extends T, D extends MatchDomain>(
  match: BooleanMatch<T, R, D>,
  candidate: T,
): Promise<BooleanMatchEvaluation<R>> {
  const internal = assertBooleanMatch(match, "match");
  const result = await internal[matchEvaluatorBrand](candidate);
  return assertBooleanEvaluation<R>(result, `matcher ${internal.name}`);
}

/** 供 Assertion runtime 消费 ScoreMatch。范围非法是 evaluator defect，绝不 clamp。 */
export async function evaluateScoreMatch<T>(match: ScoreMatch<T>, candidate: T): Promise<number> {
  const internal = internalMatchOf(match, "match");
  if (internal.kind !== "score" || internal.domain !== "value") {
    throw new TypeError("match must be a value-domain ScoreMatch");
  }
  const score = await internal[matchEvaluatorBrand](candidate);
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new TypeError(`matcher ${internal.name} returned a score outside finite [0, 1]`);
  }
  return score;
}

function hasPositiveWitnessCapability(match: BooleanMatch<unknown, unknown, "value">): boolean {
  return (internalMatchOf(match, "input matcher") as InternalMatch)[positiveWitnessBrand] === true;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
}

function assertPlainOptions(value: unknown, label: string, allowed: readonly string[]): globalThis.Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value) || Array.isArray(value)) throw new TypeError(`${label} must be an options object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} does not support option ${JSON.stringify(key)}`);
  }
  return value as globalThis.Record<string, unknown>;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function resultChild(
  result: BooleanMatchEvaluation<unknown>,
  index: number,
  label?: string,
): MatchDiagnosticChild {
  return Object.freeze({
    index,
    ...(label === undefined ? {} : { label }),
    state: result.state,
    ...(result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic }),
  });
}

function combineConjunction<T, R extends T>(
  candidate: T,
  name: string,
  fields: readonly { readonly label: string; readonly result: BooleanMatchEvaluation<unknown> }[],
): BooleanMatchEvaluation<R> {
  const children = fields.map((field, index) => resultChild(field.result, index, field.label));
  const mismatch = fields.find((field) => field.result.state === "mismatched");
  if (mismatch !== undefined) {
    return mismatched(
      diagnostic("all-of-mismatch", `${name} had a definite mismatch`, {
        expected: "all matcher fields matched",
        children,
      }),
    );
  }

  const missing = fields.find((field) => field.result.state === "unavailable");
  if (missing !== undefined) {
    const reason = (missing.result as Extract<BooleanMatchEvaluation<unknown>, { readonly state: "unavailable" }>).reason;
    return unavailable(
      reason,
      diagnostic("all-of-unavailable", `${name} could not be decided from available evidence`, {
        expected: "all matcher fields matched",
        reason,
        children,
      }),
    );
  }

  return matched(candidate as R, diagnostic("all-of-match", `${name} matched all fields`, { children }));
}

async function evaluateFields(
  fields: readonly {
    readonly label: string;
    readonly evaluate: () => Promise<BooleanMatchEvaluation<unknown>>;
  }[],
): Promise<readonly { readonly label: string; readonly result: BooleanMatchEvaluation<unknown> }[]> {
  const results: { label: string; result: BooleanMatchEvaluation<unknown> }[] = [];
  let hasDefect = false;
  let firstDefect: unknown;

  // 不短路：组合的结构化诊断必须保留每个 child；defect 在所有可执行 child 完成后原样抛出。
  for (const field of fields) {
    try {
      results.push({ label: field.label, result: await field.evaluate() });
    } catch (error) {
      if (!hasDefect) {
        hasDefect = true;
        firstDefect = error;
      }
    }
  }

  if (hasDefect) throw firstDefect;
  return results;
}

function booleanCompositionName(operator: "and" | "or", matches: readonly { readonly name: string }[]): string {
  return `${operator}(${matches.map((match) => match.name).join(", ")})`;
}

function assertComposableMatches(
  first: unknown,
  rest: readonly unknown[],
  operator: "and" | "or",
): { readonly domain: MatchDomain; readonly matches: readonly BooleanMatch<unknown, unknown, MatchDomain>[] } {
  if (rest.length === 0) throw new TypeError(`${operator}() requires at least two BooleanMatch values`);
  const firstInternal = assertBooleanMatch(first, `${operator}() first argument`);
  const matches: BooleanMatch<unknown, unknown, MatchDomain>[] = [
    first as BooleanMatch<unknown, unknown, MatchDomain>,
  ];
  for (const [index, match] of rest.entries()) {
    const internal = assertBooleanMatch(match, `${operator}() argument ${index + 2}`);
    if (internal.domain !== firstInternal.domain) {
      throw new TypeError(
        `${operator}() cannot combine ${firstInternal.domain}-domain and ${internal.domain}-domain matchers`,
      );
    }
    matches.push(match as BooleanMatch<unknown, unknown, MatchDomain>);
  }
  return { domain: firstInternal.domain, matches };
}

export function and<
  T,
  R extends T,
  D extends MatchDomain,
  const Rest extends readonly [
    BooleanMatch<NoInfer<T>, T, NoInfer<D>>,
    ...BooleanMatch<NoInfer<T>, T, NoInfer<D>>[],
  ],
>(
  first: BooleanMatch<T, R, D>,
  ...rest: Rest
): BooleanMatch<T, T & R & RefinementIntersection<Rest>, D>;
export function and(
  first: BooleanMatch<unknown, unknown, MatchDomain>,
  ...rest: readonly BooleanMatch<unknown, unknown, MatchDomain>[]
): BooleanMatch<unknown, unknown, MatchDomain> {
  const composition = assertComposableMatches(first, rest, "and");
  const name = booleanCompositionName("and", composition.matches);
  return createBooleanMatch(composition.domain, name, async (candidate: unknown) => {
    const fields = await evaluateFields(
      composition.matches.map((match, index) => ({
        label: match.name || `matcher ${index}`,
        evaluate: () => evaluateBooleanMatch(match, candidate),
      })),
    );
    return combineConjunction(candidate, name, fields);
  });
}

export function or<
  T,
  R extends T,
  D extends MatchDomain,
  const Rest extends readonly [
    BooleanMatch<NoInfer<T>, T, NoInfer<D>>,
    ...BooleanMatch<NoInfer<T>, T, NoInfer<D>>[],
  ],
>(
  first: BooleanMatch<T, R, D>,
  ...rest: Rest
): BooleanMatch<T, T & (R | RefinementOf<Rest[number]>), D>;
export function or(
  first: BooleanMatch<unknown, unknown, MatchDomain>,
  ...rest: readonly BooleanMatch<unknown, unknown, MatchDomain>[]
): BooleanMatch<unknown, unknown, MatchDomain> {
  const composition = assertComposableMatches(first, rest, "or");
  const name = booleanCompositionName("or", composition.matches);
  return createBooleanMatch(composition.domain, name, async (candidate: unknown) => {
    const fields = await evaluateFields(
      composition.matches.map((match, index) => ({
        label: match.name || `matcher ${index}`,
        evaluate: () => evaluateBooleanMatch(match, candidate),
      })),
    );
    const children = fields.map((field, index) => resultChild(field.result, index, field.label));
    if (fields.some((field) => field.result.state === "matched")) {
      return matched(candidate, diagnostic("any-of-match", `${name} matched at least one child`, { children }));
    }

    const missing = fields.find((field) => field.result.state === "unavailable");
    if (missing !== undefined) {
      const reason = (missing.result as Extract<BooleanMatchEvaluation<unknown>, { readonly state: "unavailable" }>).reason;
      return unavailable(
        reason,
        diagnostic("any-of-unavailable", `${name} had no definite match and incomplete evidence`, {
          expected: "at least one matcher matched",
          reason,
          children,
        }),
      );
    }

    return mismatched(
      diagnostic("any-of-mismatch", `${name} had no matching child`, {
        expected: "at least one matcher matched",
        children,
      }),
    );
  });
}

export function not<T>(match: BooleanMatch<T, T, "value">): BooleanMatch<T, T, "value"> {
  assertBooleanMatch(match, "not() argument", "value");
  return createBooleanMatch("value", `not(${match.name})`, async (candidate) => {
    const result = await evaluateBooleanMatch(match, candidate);
    if (result.state === "matched") {
      return mismatched(
        diagnostic("not-mismatch", `not(${match.name}) failed because its child matched`, {
          expected: `not ${match.name}`,
          children: [resultChild(result, 0, match.name)],
        }),
      );
    }
    if (result.state === "mismatched") {
      return matched(candidate, diagnostic("not-match", `not(${match.name}) matched`, {
        children: [resultChild(result, 0, match.name)],
      }));
    }
    return unavailable(
      result.reason,
      diagnostic("not-unavailable", `not(${match.name}) could not decide its child`, {
        expected: `not ${match.name}`,
        reason: result.reason,
        children: [resultChild(result, 0, match.name)],
      }),
    );
  });
}

export interface TextMatchOptions {
  readonly stripComments?: boolean;
}

function normalizeTextOptions(value: unknown, label: string): Readonly<TextMatchOptions> {
  const options = assertPlainOptions(value, label, ["stripComments"]);
  if (options.stripComments !== undefined && typeof options.stripComments !== "boolean") {
    throw new TypeError(`${label}.stripComments must be a boolean`);
  }
  return Object.freeze(options as TextMatchOptions);
}

function textCandidate(value: unknown, options: TextMatchOptions): string | undefined {
  if (typeof value !== "string") return undefined;
  return options.stripComments === true ? stripComments(value) : value;
}

export function includes(text: string, options?: TextMatchOptions): BooleanMatch<string, string> {
  assertNonEmptyString(text, "includes() text");
  const normalizedOptions = normalizeTextOptions(options, "includes() options");
  const name = `includes(${quoted(text)})`;
  return createBooleanMatch("value", name, (value) => {
    const candidate = textCandidate(value, normalizedOptions);
    if (candidate === undefined) {
      return mismatched(diagnostic("text-candidate-type", `${name} only accepts string candidates`, { expected: "string" }));
    }
    if (candidate.includes(text)) {
      return matched(value, diagnostic("text-includes-match", `${name} found the literal text`, { expected: quoted(text) }));
    }
    return mismatched(diagnostic("text-includes-mismatch", `${name} did not find the literal text`, { expected: quoted(text) }));
  });
}

export function excludes(text: string, options?: TextMatchOptions): BooleanMatch<string, string> {
  assertNonEmptyString(text, "excludes() text");
  const normalizedOptions = normalizeTextOptions(options, "excludes() options");
  const name = `excludes(${quoted(text)})`;
  return createBooleanMatch("value", name, (value) => {
    const candidate = textCandidate(value, normalizedOptions);
    if (candidate === undefined) {
      return mismatched(diagnostic("text-candidate-type", `${name} only accepts string candidates`, { expected: "string" }));
    }
    if (!candidate.includes(text)) {
      return matched(value, diagnostic("text-excludes-match", `${name} did not find the literal text`, { expected: quoted(text) }));
    }
    return mismatched(diagnostic("text-excludes-mismatch", `${name} found excluded literal text`, { expected: quoted(text) }));
  });
}

export function pattern(expression: RegExp, options?: TextMatchOptions): BooleanMatch<string, string> {
  if (!(expression instanceof RegExp)) throw new TypeError("pattern() expression must be a RegExp");
  const normalizedOptions = normalizeTextOptions(options, "pattern() options");
  const name = `pattern(${expression.toString()})`;
  return createBooleanMatch("value", name, (value) => {
    const candidate = textCandidate(value, normalizedOptions);
    if (candidate === undefined) {
      return mismatched(diagnostic("text-candidate-type", `${name} only accepts string candidates`, { expected: "string" }));
    }

    // 新 clone 的 lastIndex 从零开始，既满足 g/y 每次独立求值，也完全不修改作者实例。
    const isolatedExpression = new RegExp(expression.source, expression.flags);
    isolatedExpression.lastIndex = 0;
    if (isolatedExpression.test(candidate)) {
      return matched(value, diagnostic("pattern-match", `${name} matched`, { expected: expression.toString() }));
    }
    return mismatched(diagnostic("pattern-mismatch", `${name} did not match`, { expected: expression.toString() }));
  });
}

/** 归一化 Levenshtein similarity；它是连续分数，不携带默认阈值或 verdict 策略。 */
export function similarity(expected: string): ScoreMatch<string> {
  if (typeof expected !== "string") throw new TypeError("similarity() expected must be a string");
  const name = `similarity(${quoted(expected)})`;
  return createScoreMatch(name, (value) => {
    if (typeof value !== "string") throw new TypeError(`${name} only accepts string candidates`);
    const maxLength = Math.max(value.length, expected.length);
    if (maxLength === 0) return 1;
    return 1 - levenshtein(value, expected) / maxLength;
  });
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  let current = new Array<number>(b.length + 1);
  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = a.charCodeAt(row - 1) === b.charCodeAt(column - 1) ? 0 : 1;
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + substitution,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length]!;
}

/** 至少含 min 个去重 http(s) URL 的纯文本 matcher。 */
export function includesUrl(min = 1): BooleanMatch<string, string> {
  const name = `includesUrl(min=${min})`;
  return createBooleanMatch("value", name, (value) => {
    if (typeof value !== "string") {
      return mismatched(diagnostic("text-candidate-type", `${name} only accepts string candidates`, { expected: "string" }));
    }
    const urls = new Set(value.match(/https?:\/\/[^\s<>()"'\x60]+/g) ?? []);
    if (urls.size >= min) {
      return matched(value, diagnostic("url-count-match", `${name} found enough distinct URLs`, { expected: `>= ${min}` }));
    }
    return mismatched(diagnostic("url-count-mismatch", `${name} did not find enough distinct URLs`, { expected: `>= ${min}` }));
  });
}

/** 至少含 min 个 Markdown heading 的纯文本 matcher。 */
export function hasSections(min = 2): BooleanMatch<string, string> {
  const name = `hasSections(min=${min})`;
  return createBooleanMatch("value", name, (value) => {
    if (typeof value !== "string") {
      return mismatched(diagnostic("text-candidate-type", `${name} only accepts string candidates`, { expected: "string" }));
    }
    const count = (value.match(/^#{1,6}\s+\S/gm) ?? []).length;
    if (count >= min) {
      return matched(value, diagnostic("heading-count-match", `${name} found enough headings`, { expected: `>= ${min}` }));
    }
    return mismatched(diagnostic("heading-count-mismatch", `${name} did not find enough headings`, { expected: `>= ${min}` }));
  });
}

function optionalLabel(label: string | undefined, factory: string): string {
  if (label !== undefined && typeof label !== "string") throw new TypeError(`${factory}() label must be a string`);
  return label === undefined || label.length === 0 ? `${factory}()` : `${factory}(${label})`;
}

/** 非 null / undefined 的 value matcher；泛型调用可保留原 candidate 的非空收窄。 */
export function isDefined(label?: string): BooleanMatch<unknown, {}>;
export function isDefined<T>(label?: string): BooleanMatch<T, Exclude<T, null | undefined>>;
export function isDefined<T = unknown>(label?: string): BooleanMatch<T, Exclude<T, null | undefined>> {
  const name = optionalLabel(label, "isDefined");
  return createBooleanMatch("value", name, (value) => {
    if (value !== null && value !== undefined) {
      return matched(value as Exclude<T, null | undefined>, diagnostic("defined-match", `${name} matched`, { expected: "defined" }));
    }
    return mismatched(diagnostic("defined-mismatch", `${name} did not match`, { expected: "defined" }));
  });
}

/** value === true 的 refinement matcher。 */
export function isTrue<T = unknown>(label?: string): BooleanMatch<T, T & true> {
  const name = optionalLabel(label, "isTrue");
  return createBooleanMatch("value", name, (value) => {
    if (value === true) return matched(value as T & true, diagnostic("true-match", `${name} matched`, { expected: "true" }));
    return mismatched(diagnostic("true-mismatch", `${name} did not match`, { expected: "true" }));
  });
}

/** value === false 的 refinement matcher。 */
export function isFalse<T = unknown>(label?: string): BooleanMatch<T, T & false> {
  const name = optionalLabel(label, "isFalse");
  return createBooleanMatch("value", name, (value) => {
    if (value === false) return matched(value as T & false, diagnostic("false-match", `${name} matched`, { expected: "false" }));
    return mismatched(diagnostic("false-mismatch", `${name} did not match`, { expected: "false" }));
  });
}

/** CommandResult-like candidate 的 exitCode === 0 matcher；不读取 stdout / stderr。 */
export function commandSucceeded<T = unknown>(): BooleanMatch<T, T & { readonly exitCode: 0 }> {
  const name = "commandSucceeded()";
  return createBooleanMatch("value", name, (value) => {
    if (value !== null && typeof value === "object" && (value as { readonly exitCode?: unknown }).exitCode === 0) {
      return matched(value as T & { readonly exitCode: 0 }, diagnostic("command-succeeded", `${name} matched`, { expected: "exit 0" }));
    }
    return mismatched(diagnostic("command-failed", `${name} did not match`, { expected: "exit 0" }));
  });
}

/** 小而稳定的深相等：基本值、NaN、Array、Date 与 enumerable object properties。 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return deepEqualInner(a, b, new Map<object, object>());
}

function deepEqualInner(a: unknown, b: unknown, seen: Map<object, object>): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();

  const seenB = seen.get(a);
  if (seenB !== undefined) return seenB === b;
  seen.set(a, b);

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqualInner(a[index], b[index], seen)) return false;
    }
    return true;
  }

  const aObject = a as globalThis.Record<string, unknown>;
  const bObject = b as globalThis.Record<string, unknown>;
  const aKeys = Object.keys(aObject);
  const bKeys = Object.keys(bObject);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObject, key) || !deepEqualInner(aObject[key], bObject[key], seen)) {
      return false;
    }
  }
  return true;
}

export function equals<const T>(expected: T): BooleanMatch<unknown, T> {
  const name = "equals(value)";
  return createBooleanMatch<unknown, T, "value">("value", name, (candidate) => {
    if (deepEqual(candidate, expected)) return matched(expected, diagnostic("equals-match", `${name} matched`));
    return mismatched(diagnostic("equals-mismatch", `${name} did not match`));
  });
}

function isStandardSchema(value: unknown): value is StandardSchema {
  if (!isRecord(value)) return false;
  const standard = value["~standard"];
  return isRecord(standard) && typeof standard.validate === "function";
}

function standardIssuePath(value: unknown, label: string): readonly MatchPathSegment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} returned a schema issue with an invalid path`);
  return value.map((segment) => {
    const key = isRecord(segment) && "key" in segment ? segment.key : segment;
    if (typeof key === "string" || typeof key === "number") return key;
    if (typeof key === "symbol") return String(key);
    throw new TypeError(`${label} returned a schema issue with an invalid path segment`);
  });
}

export function matches<S extends StandardSchema>(
  schema: S,
): BooleanMatch<unknown, StandardSchema.InferInput<S>, "value"> {
  if (!isStandardSchema(schema)) throw new TypeError("matches() schema must implement Standard Schema v1");
  const name = "matches(schema)";
  return createBooleanMatch("value", name, async (candidate) => {
    const result = await schema["~standard"].validate(candidate);
    if (!isRecord(result)) throw new TypeError(`${name} schema returned an invalid result`);

    if (result.issues === undefined) {
      // Standard Schema output (including transforms) is intentionally ignored: Match refines the original candidate.
      return matched(candidate as StandardSchema.InferInput<S>, diagnostic("schema-match", `${name} validated the original candidate`));
    }
    if (!Array.isArray(result.issues)) throw new TypeError(`${name} schema returned invalid issues`);

    const children = result.issues.map((issue, index) => {
      if (!isRecord(issue) || typeof issue.message !== "string") {
        throw new TypeError(`${name} schema returned an invalid issue`);
      }
      const path = standardIssuePath(issue.path, name);
      return Object.freeze({
        index,
        state: "mismatched" as const,
        diagnostic: diagnostic("schema-issue", issue.message, { path }),
      });
    });
    return mismatched(
      diagnostic("schema-mismatch", `${name} rejected the candidate`, {
        expected: "Standard Schema validation success",
        children,
      }),
    );
  });
}

/**
 * 旧 context 接线还会调用这一个内部 helper。它不再接受 Zod-style fallback；新的公共 matches()
 * 使用上面的严格 Standard Schema 入口，异常则由 evaluator 作为 defect 处理。
 */
export async function validateSchema(value: unknown, schema: unknown): Promise<boolean> {
  if (!isStandardSchema(schema)) return false;
  try {
    const result = await schema["~standard"].validate(value);
    return isRecord(result) && result.issues === undefined;
  } catch {
    return false;
  }
}

export function satisfies<T, R extends T>(
  label: string,
  predicate: (value: T) => value is R,
): BooleanMatch<T, R>;
export function satisfies<T>(
  label: string,
  predicate: (value: T) => boolean | Promise<boolean>,
): BooleanMatch<T, T>;
export function satisfies<T, R extends T = T>(
  label: string,
  predicate: (value: T) => boolean | Promise<boolean>,
): BooleanMatch<T, R> | BooleanMatch<T, T> {
  assertNonEmptyString(label, "satisfies() label");
  if (typeof predicate !== "function") throw new TypeError("satisfies() predicate must be a function");
  return createBooleanMatch<T, R, "value">("value", `satisfies(${label})`, async (candidate) => {
    const value = await predicate(candidate);
    if (typeof value !== "boolean") throw new TypeError(`matcher satisfies(${label}) returned a non-boolean result`);
    if (value) return matched(candidate as R, diagnostic("value-match", `satisfies(${label}) matched`));
    return mismatched(diagnostic("value-mismatch", `satisfies(${label}) did not match`));
  });
}

export function defineValueMatch<T, R extends T>(spec: {
  readonly name: string;
  readonly evaluate: (value: T) => value is R;
}): BooleanMatch<T, R>;
export function defineValueMatch<T>(spec: {
  readonly name: string;
  readonly evaluate: (value: T) => boolean | Promise<boolean>;
}): BooleanMatch<T, T>;
export function defineValueMatch<T, R extends T = T>(spec: {
  readonly name: string;
  readonly evaluate: (value: T) => boolean | Promise<boolean>;
}): BooleanMatch<T, R> | BooleanMatch<T, T> {
  if (!isRecord(spec)) throw new TypeError("defineValueMatch() spec must be an object");
  assertNonEmptyString(spec.name, "defineValueMatch() spec.name");
  if (typeof spec.evaluate !== "function") throw new TypeError("defineValueMatch() spec.evaluate must be a function");
  return createBooleanMatch<T, R, "value">("value", spec.name, async (candidate) => {
    const value = await spec.evaluate(candidate);
    if (typeof value !== "boolean") throw new TypeError(`matcher ${spec.name} returned a non-boolean result`);
    if (value) return matched(candidate as R, diagnostic("value-match", `${spec.name} matched`));
    return mismatched(diagnostic("value-mismatch", `${spec.name} did not match`));
  });
}

export function defineScoreMatch<T>(spec: {
  readonly name: string;
  readonly score: (value: T) => number | Promise<number>;
}): ScoreMatch<T> {
  if (!isRecord(spec)) throw new TypeError("defineScoreMatch() spec must be an object");
  assertNonEmptyString(spec.name, "defineScoreMatch() spec.name");
  if (typeof spec.score !== "function") throw new TypeError("defineScoreMatch() spec.score must be a function");
  return createScoreMatch(spec.name, async (candidate) => {
    const score = await spec.score(candidate);
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new TypeError(`matcher ${spec.name} returned a score outside finite [0, 1]`);
    }
    return score;
  });
}

interface ReferencePathPattern {
  readonly original: string;
  readonly components: readonly string[];
  readonly matcher: RegExp;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function normalizeReferencePath(value: unknown, label: string): readonly string[] {
  assertNonEmptyString(value, label);
  const components = value.split(/[\\/]+/u).filter((component) => component.length > 0 && component !== ".");
  if (components.length === 0) throw new TypeError(`${label} normalizes to an empty path`);
  return Object.freeze(components);
}

function pathPattern(components: readonly string[]): RegExp {
  // Whitespace / quoting can bound a path embedded in a tool input, while '-' and '.' stay in a component so
  // `agents` cannot match `agents-old` and `.niceeval` cannot match `.niceevaluation`.
  const componentChar = "\\p{L}\\p{N}_.-";
  const betweenComponents = "[\\\\/]+(?:\\.[\\\\/]+)*";
  const source = components.map(escapeRegExp).join(betweenComponents);
  return new RegExp(`(?<![${componentChar}])${source}(?![${componentChar}])`, "u");
}

function normalizeReferencePatterns(paths: readonly [string, ...string[]]): readonly ReferencePathPattern[] {
  if (!Array.isArray(paths) || paths.length === 0) throw new TypeError("referencesAnyPath() requires at least one path");
  const seen = new Set<string>();
  const patterns = paths.map((path, index) => {
    const components = normalizeReferencePath(path, `referencesAnyPath() paths[${index}]`);
    const identity = components.join("\u0000");
    if (seen.has(identity)) throw new TypeError(`referencesAnyPath() has duplicate normalized path ${quoted(path)}`);
    seen.add(identity);
    return Object.freeze({ original: path, components, matcher: pathPattern(components) });
  });
  return Object.freeze(patterns);
}

interface PathWitness {
  readonly pointer: string;
  readonly pattern: ReferencePathPattern;
}

function jsonPointerSegment(value: string | number): string {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function isPlainJsonObject(value: object): value is globalThis.Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndexKey(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function findReferencedPath(
  value: unknown,
  patterns: readonly ReferencePathPattern[],
  pointer = "",
  ancestors = new WeakSet<object>(),
): PathWitness | undefined {
  if (typeof value === "string") {
    const pattern = patterns.find((candidate) => {
      candidate.matcher.lastIndex = 0;
      return candidate.matcher.test(value);
    });
    return pattern === undefined ? undefined : { pointer, pattern };
  }
  if (value === null || typeof value === "boolean") return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("referencesAnyPath() received a non-JSON number");
    return undefined;
  }
  if (typeof value !== "object") throw new TypeError("referencesAnyPath() received a non-JSON value");
  if (ancestors.has(value)) throw new TypeError("referencesAnyPath() received a cyclic JSON value");
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      for (const key of Object.keys(value)) {
        if (!isArrayIndexKey(key, value.length)) {
          throw new TypeError("referencesAnyPath() received a non-JSON array property");
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new TypeError("referencesAnyPath() received a sparse array or accessor");
        }
        const witness = findReferencedPath(descriptor.value, patterns, `${pointer}/${index}`, ancestors);
        if (witness !== undefined) return witness;
      }
      return undefined;
    }

    if (!isPlainJsonObject(value)) throw new TypeError("referencesAnyPath() received a non-plain JSON object");
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError("referencesAnyPath() received an accessor property");
      }
      const witness = findReferencedPath(
        descriptor.value,
        patterns,
        `${pointer}/${jsonPointerSegment(key)}`,
        ancestors,
      );
      if (witness !== undefined) return witness;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

export function referencesAnyPath(
  paths: readonly [string, ...string[]],
): BooleanMatch<JsonValue, JsonValue, "value"> {
  const patterns = normalizeReferencePatterns(paths);
  const name = `referencesAnyPath(${patterns.length} paths)`;
  return createBooleanMatch(
    "value",
    name,
    (candidate) => {
      const witness = findReferencedPath(candidate, patterns);
      if (witness !== undefined) {
        return matched(
          candidate,
          diagnostic("path-reference-match", `${name} found a referenced path`, {
            expected: witness.pattern.components.join("/"),
            locator: { kind: "json-pointer", pointer: witness.pointer },
          }),
        );
      }
      return mismatched(
        diagnostic("path-reference-mismatch", `${name} found no referenced path`, {
          expected: patterns.map((pattern) => pattern.components.join("/")).join(" | "),
        }),
      );
    },
    { positiveWitness: true },
  );
}

export type ToolStatus = Extract<LogicalToolOccurrence["lifecycle"], { readonly state: "available" }>["status"];

export interface CommandMatchOptions {
  readonly argsStart?: readonly string[];
  readonly excludes?: readonly string[];
  readonly status?: ToolStatus;
}

export interface ToolMatchOptions {
  readonly input?: BooleanMatch<JsonValue, JsonValue, "value">;
  readonly output?: BooleanMatch<JsonValue, JsonValue, "value">;
  readonly status?: ToolStatus;
}

/**
 * Turns the recursive JsonMatch language into a managed value Match.  Raw
 * JsonMatch stays at this explicit bridge; tool assertions consume only the
 * branded Match so every tool field follows the same evaluator path.
 */
export function jsonMatch(expected: JsonMatch): BooleanMatch<JsonValue, JsonValue, "value"> {
  const normalized = normalizeJsonMatch(expected, "jsonMatch() expected");
  const name = "jsonMatch(...)";
  return createBooleanMatch("value", name, (candidate) => {
    if (matchesJson(candidate, normalized)) {
      return matched(candidate, diagnostic("json-match", `${name} matched`));
    }
    return mismatched(
      diagnostic("json-mismatch", `${name} did not match`, {
        expected: "the supplied JsonMatch pattern",
        received: "the candidate JSON value",
      }),
    );
  });
}

function normalizeJsonMatch(value: unknown, label: string, active = new WeakSet<object>()): JsonMatch {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`${label} must not contain a non-finite number`);
    }
    return value;
  }
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (typeof value === "function") return value as (candidate: unknown) => boolean;
  if (typeof value !== "object") throw new TypeError(`${label} must be a JsonMatch value`);
  if (active.has(value)) throw new TypeError(`${label} must not be cyclic`);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item, index) => normalizeJsonMatch(item, `${label}[${index}]`, active)));
    }
    if (!isPlainJsonObject(value)) throw new TypeError(`${label} must use a plain object`);
    const entries: [string, JsonMatch][] = [];
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError(`${label}.${key} must not be an accessor`);
      }
      entries.push([key, normalizeJsonMatch(descriptor.value, `${label}.${key}`, active)]);
    }
    return Object.freeze(Object.fromEntries(entries));
  } finally {
    active.delete(value);
  }
}

function normalizeStatus(value: unknown, label: string): ToolStatus | undefined {
  if (value === undefined) return undefined;
  if (value === "pending" || value === "completed" || value === "failed" || value === "rejected") return value;
  throw new TypeError(`${label} must be pending, completed, failed, or rejected`);
}

function normalizeTokens(value: unknown, label: string, unique: boolean): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of command tokens`);
  const tokens = value.map((token, index) => {
    assertNonEmptyString(token, `${label}[${index}]`);
    return token;
  });
  if (unique && new Set(tokens).size !== tokens.length) throw new TypeError(`${label} must not contain duplicate tokens`);
  return Object.freeze(tokens);
}

function lifecycleResult(
  occurrence: LogicalToolOccurrence,
  expected: ToolStatus | undefined,
): BooleanMatchEvaluation<unknown> {
  const lifecycle = occurrence.lifecycle;
  if (!isRecord(lifecycle) || (lifecycle.state !== "available" && lifecycle.state !== "opaque")) {
    throw new TypeError("tool occurrence has an invalid lifecycle envelope");
  }
  if (lifecycle.state === "opaque") {
    if (typeof lifecycle.reason !== "string" || lifecycle.reason.length === 0) {
      throw new TypeError("tool occurrence has an opaque lifecycle without a reason");
    }
    return unavailable(
      lifecycle.reason,
      diagnostic("tool-lifecycle-unavailable", "tool lifecycle is not fully observed", {
        expected,
        reason: lifecycle.reason,
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  if (expected === undefined) {
    return matched(
      occurrence,
      diagnostic("lifecycle-unrestricted", "lifecycle is unrestricted", {
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  if (lifecycle.status !== expected) {
    return mismatched(
      diagnostic("tool-status-mismatch", "tool lifecycle status did not match", {
        expected,
        received: typeof lifecycle.status === "string" ? lifecycle.status : undefined,
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  return matched(
    occurrence,
    diagnostic("tool-status-match", "tool lifecycle status matched", {
      expected,
      locator: { kind: "tool-occurrence", id: occurrence.id },
    }),
  );
}

function occurrenceNameResult(occurrence: LogicalToolOccurrence, expected: string): BooleanMatchEvaluation<unknown> {
  if (!isRecord(occurrence.name) || typeof occurrence.name.original !== "string") {
    throw new TypeError("tool occurrence has an invalid name envelope");
  }
  // `unknown` means the adapter could not map this domain-specific tool onto
  // NiceEval's canonical vocabulary. It must not hide the original name that
  // the author can still check exactly.
  const observed = occurrence.name.canonical === undefined || occurrence.name.canonical === "unknown"
    ? occurrence.name.original
    : occurrence.name.canonical;
  if (observed !== expected) {
    return mismatched(
      diagnostic("tool-name-mismatch", "tool name did not match", {
        expected: quoted(expected),
        received: quoted(observed),
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  return matched(
    occurrence,
    diagnostic("tool-name-match", "tool name matched exactly", {
      expected: quoted(expected),
      locator: { kind: "tool-occurrence", id: occurrence.id },
    }),
  );
}

async function toolEvidenceResult(
  occurrence: LogicalToolOccurrence,
  field: "input" | "output",
  match: BooleanMatch<JsonValue, JsonValue, "value">,
): Promise<BooleanMatchEvaluation<unknown>> {
  const evidence = occurrence[field];
  if (!isRecord(evidence) || (evidence.state !== "complete" && evidence.state !== "partial" && evidence.state !== "unavailable")) {
    throw new TypeError(`tool occurrence has an invalid ${field} envelope`);
  }
  if (evidence.state === "unavailable") {
    if (typeof evidence.reason !== "string" || evidence.reason.length === 0) {
      throw new TypeError(`tool occurrence has unavailable ${field} without a reason`);
    }
    return unavailable(
      evidence.reason,
      diagnostic(`tool-${field}-unavailable`, `tool ${field} is unavailable`, {
        reason: evidence.reason,
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }

  const result = await evaluateBooleanMatch(match, evidence.value);
  if (evidence.state === "complete") return result;

  // partial input can only produce a positive result when the matcher itself carries the narrowed witness
  // capability. A visible reference hit survives hidden leaves; general predicates / schema checks do not.
  if (result.state === "matched" && hasPositiveWitnessCapability(match as BooleanMatch<unknown, unknown, "value">)) {
    return result;
  }

  return unavailable(
    `tool-${field}-coverage-partial`,
    diagnostic(`tool-${field}-coverage-partial`, `tool ${field} is partial without a decisive positive witness`, {
      reason: `tool-${field}-coverage-partial`,
      locator: { kind: "tool-occurrence", id: occurrence.id },
      ...(Array.isArray(evidence.opaquePointers) ? { received: evidence.opaquePointers.join(",") } : {}),
    }),
  );
}

export function toolMatch(name: string, options?: ToolMatchOptions): ToolMatch;
export function toolMatch(options: ToolMatchOptions): ToolMatch;
export function toolMatch(
  nameOrOptions:
    | string
    | ToolMatchOptions,
  options?: ToolMatchOptions,
): ToolMatch {
  let expectedName: string | undefined;
  let input: BooleanMatch<JsonValue, JsonValue, "value"> | undefined;
  let output: BooleanMatch<JsonValue, JsonValue, "value"> | undefined;
  let status: ToolStatus | undefined;

  if (typeof nameOrOptions === "string") {
    assertNonEmptyString(nameOrOptions, "toolMatch() name");
    expectedName = nameOrOptions;
    const normalized = assertPlainOptions(options, "toolMatch() options", ["input", "output", "status"]);
    if (normalized.input !== undefined) {
      assertBooleanMatch(normalized.input, "toolMatch() options.input", "value");
      input = normalized.input as BooleanMatch<JsonValue, JsonValue, "value">;
    }
    if (normalized.output !== undefined) {
      assertBooleanMatch(normalized.output, "toolMatch() options.output", "value");
      output = normalized.output as BooleanMatch<JsonValue, JsonValue, "value">;
    }
    status = normalizeStatus(normalized.status, "toolMatch() options.status");
  } else {
    if (options !== undefined) throw new TypeError("toolMatch(options) does not accept a second argument");
    const normalized = assertPlainOptions(nameOrOptions, "toolMatch() options", ["input", "output", "status"]);
    if (normalized.input === undefined && normalized.output === undefined && normalized.status === undefined) {
      throw new TypeError("toolMatch(options) requires input, output, or status");
    }
    if (normalized.input !== undefined) {
      assertBooleanMatch(normalized.input, "toolMatch() options.input", "value");
      input = normalized.input as BooleanMatch<JsonValue, JsonValue, "value">;
    }
    if (normalized.output !== undefined) {
      assertBooleanMatch(normalized.output, "toolMatch() options.output", "value");
      output = normalized.output as BooleanMatch<JsonValue, JsonValue, "value">;
    }
    status = normalizeStatus(normalized.status, "toolMatch() options.status");
  }

  const name = expectedName === undefined
    ? `toolMatch(${[
      input === undefined ? undefined : `input=${input.name}`,
      output === undefined ? undefined : `output=${output.name}`,
      status === undefined ? undefined : `status=${status}`,
    ].filter((part): part is string => part !== undefined).join(", ")})`
    : `toolMatch(${quoted(expectedName)})`;
  return createBooleanMatch("tool", name, async (occurrence) => {
    const fields = await evaluateFields([
      ...(expectedName === undefined
        ? []
        : [{ label: "name", evaluate: async () => occurrenceNameResult(occurrence, expectedName!) }]),
      ...(input === undefined ? [] : [{ label: "input", evaluate: () => toolEvidenceResult(occurrence, "input", input!) }]),
      ...(output === undefined ? [] : [{ label: "output", evaluate: () => toolEvidenceResult(occurrence, "output", output!) }]),
      { label: "status", evaluate: async () => lifecycleResult(occurrence, status) },
    ]);
    return combineConjunction(occurrence, name, fields);
  });
}

/** @internal Assert-first accepts only branded tool-domain matches. */
export function assertManagedToolMatch(value: unknown, label = "match"): ToolMatch {
  assertBooleanMatch(value, label, "tool");
  return value as ToolMatch;
}

/** @internal Assert-first accepts only branded event-domain matches. */
export function assertManagedEventMatch(value: unknown, label = "match"): EventMatch {
  assertBooleanMatch(value, label, "event");
  return value as EventMatch;
}

export type ToolMatchQuantifier =
  | { readonly kind: "at-least"; readonly count: number }
  | { readonly kind: "exact"; readonly count: number }
  | { readonly kind: "absent" };

export interface ToolMatchCollectionOptions {
  readonly quantifier: ToolMatchQuantifier;
  /** Scope-level action coverage that can hide additional candidates. */
  readonly coverageReason?: string;
}

/**
 * The sole collection evaluator for scoped tool Assertions. It evaluates each
 * occurrence through ToolMatch, then folds exact / at-least / absent with the
 * same three-valued rule: a definite counterexample wins; incomplete evidence
 * cannot manufacture a positive count or an absence proof.
 */
export async function evaluateToolMatchCollection(
  match: ToolMatch,
  occurrences: readonly LogicalToolOccurrence[],
  options: ToolMatchCollectionOptions,
): Promise<BooleanMatchEvaluation<LogicalToolOccurrence | undefined>> {
  const candidates: CandidateResult<LogicalToolOccurrence>[] = [];
  for (const occurrence of occurrences) {
    candidates.push(Object.freeze({
      candidate: occurrence,
      result: await evaluateBooleanMatch(match, occurrence),
    }));
  }
  const children = candidates.map((candidate, index) => resultChild(
    candidate.result,
    index,
    `candidate ${candidate.candidate.id}`,
  ));
  const matches = candidates.filter((candidate) => candidate.result.state === "matched");
  const unavailableCandidate = candidates.find((candidate) => candidate.result.state === "unavailable");
  const unavailableReason = unavailableCandidate?.result.state === "unavailable"
    ? unavailableCandidate.result.reason
    : options.coverageReason;
  const incomplete = unavailableReason !== undefined;
  const received = `${matches.length} definite match${matches.length === 1 ? "" : "es"}`;
  const candidateLocator = (candidate: CandidateResult<LogicalToolOccurrence> | undefined) =>
    candidate === undefined ? undefined : { kind: "tool-occurrence" as const, id: candidate.candidate.id };

  if (options.quantifier.kind === "absent") {
    const first = matches[0];
    if (first !== undefined) {
      return mismatched(diagnostic("tool-absence-mismatch", `notCalledTool(${match.name}) observed a matching tool`, {
        expected: `no ${match.name}`,
        received,
        locator: candidateLocator(first),
        children,
      }));
    }
    if (incomplete) {
      return unavailable(unavailableReason, diagnostic("tool-absence-unavailable", `notCalledTool(${match.name}) cannot prove absence`, {
        expected: `no ${match.name}`,
        received,
        reason: unavailableReason,
        children,
      }));
    }
    return matched(undefined, diagnostic("tool-absence-match", `notCalledTool(${match.name}) observed no matching tool`, {
      expected: `no ${match.name}`,
      received,
      children,
    }));
  }

  const { kind, count } = options.quantifier;
  const expected = kind === "exact" ? `exactly ${count} × ${match.name}` : `at least ${count} × ${match.name}`;
  if (kind === "exact" && matches.length > count) {
    const overage = matches[count];
    return mismatched(diagnostic("tool-count-exceeded", `calledTool(${match.name}) exceeded its exact count`, {
      expected,
      received,
      locator: candidateLocator(overage),
      children,
    }));
  }
  if (kind === "at-least" && matches.length >= count) {
    return matched(matches[0]?.candidate, diagnostic("tool-count-match", `calledTool(${match.name}) satisfied its lower bound`, {
      expected,
      received,
      children,
    }));
  }
  if (kind === "exact" && matches.length === count && !incomplete) {
    return matched(matches[0]?.candidate, diagnostic("tool-count-match", `calledTool(${match.name}) satisfied its exact count`, {
      expected,
      received,
      children,
    }));
  }
  if (incomplete) {
    return unavailable(unavailableReason, diagnostic("tool-count-unavailable", `calledTool(${match.name}) cannot decide its count`, {
      expected,
      received,
      reason: unavailableReason,
      children,
    }));
  }
  return mismatched(diagnostic("tool-count-mismatch", `calledTool(${match.name}) did not satisfy its count`, {
    expected,
    received,
    children,
  }));
}

interface CandidateResult<T> {
  readonly candidate: T;
  readonly result: BooleanMatchEvaluation<unknown>;
}

function commandResult(
  occurrence: LogicalToolOccurrence,
  executable: string,
  argsStart: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
): BooleanMatchEvaluation<unknown> {
  const projection = occurrence.command;
  if (projection === undefined) {
    return unavailable(
      "logical-command-unavailable",
      diagnostic("logical-command-unavailable", "tool occurrence has no durable command projection", {
        reason: "logical-command-unavailable",
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  if (!isRecord(projection) || (projection.kind !== "command" && projection.kind !== "not-command")) {
    throw new TypeError("tool occurrence has an invalid command projection");
  }
  if (projection.kind === "not-command") {
    return mismatched(
      diagnostic("not-command", "tool occurrence is not a command", {
        expected: quoted(executable),
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }

  const logical = projection.logical;
  if (!isRecord(logical) || (logical.state !== "available" && logical.state !== "opaque")) {
    throw new TypeError("command projection has an invalid logical envelope");
  }
  if (logical.normalizer !== "logical-command/v1") {
    throw new TypeError("command projection does not use logical-command/v1");
  }
  if (logical.state === "opaque") {
    if (typeof logical.reason !== "string" || logical.reason.length === 0) {
      throw new TypeError("opaque logical command has no reason");
    }
    return unavailable(
      `logical-command-opaque:${logical.reason}`,
      diagnostic("logical-command-opaque", "logical command is opaque", {
        reason: logical.reason,
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }

  if (typeof logical.executable !== "string" || !Array.isArray(logical.args) || !logical.args.every((arg) => typeof arg === "string")) {
    throw new TypeError("available logical command has an invalid argv envelope");
  }
  if (logical.executable !== executable) {
    return mismatched(
      diagnostic("logical-executable-mismatch", "logical executable did not match exactly", {
        expected: quoted(executable),
        received: quoted(logical.executable),
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  if (argsStart !== undefined && !argsStart.every((token, index) => logical.args[index] === token)) {
    return mismatched(
      diagnostic("logical-args-prefix-mismatch", "logical argv did not start with the expected exact tokens", {
        expected: argsStart.map(quoted).join(" "),
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  if (excludes !== undefined && excludes.some((token) => logical.args.includes(token))) {
    return mismatched(
      diagnostic("logical-args-excluded-token", "logical argv contained an excluded exact token", {
        expected: `without ${excludes.map(quoted).join(", ")}`,
        locator: { kind: "tool-occurrence", id: occurrence.id },
      }),
    );
  }
  return matched(
    occurrence,
    diagnostic("logical-command-match", "logical command matched exact executable and token rules", {
      expected: quoted(executable),
      locator: { kind: "tool-occurrence", id: occurrence.id },
    }),
  );
}

export function commandMatch(executable: string, options?: CommandMatchOptions): ToolMatch<LogicalCommandOccurrence> {
  assertNonEmptyString(executable, "commandMatch() executable");
  const normalized = assertPlainOptions(options, "commandMatch() options", ["argsStart", "excludes", "status"]);
  const argsStart = normalizeTokens(normalized.argsStart, "commandMatch() options.argsStart", false);
  const excludes = normalizeTokens(normalized.excludes, "commandMatch() options.excludes", true);
  const status = normalizeStatus(normalized.status, "commandMatch() options.status");
  const details = [
    argsStart === undefined ? undefined : `argsStart=[${argsStart.map(quoted).join(", ")}]`,
    excludes === undefined ? undefined : `excludes=[${excludes.map(quoted).join(", ")}]`,
    status === undefined ? undefined : `status=${status}`,
  ]
    .filter((detail): detail is string => detail !== undefined)
    .join(", ");
  const name = `commandMatch(${quoted(executable)}${details.length === 0 ? "" : `, ${details}`})`;

  return createBooleanMatch("tool", name, async (occurrence) => {
    const fields = await evaluateFields([
      { label: "command", evaluate: async () => commandResult(occurrence, executable, argsStart, excludes) },
      { label: "status", evaluate: async () => lifecycleResult(occurrence, status) },
    ]);
    return combineConjunction<LogicalToolOccurrence, LogicalCommandOccurrence>(occurrence, name, fields);
  });
}

export interface EventOptionsByType {
  readonly message: {
    readonly role?: "assistant" | "user";
    readonly text?: BooleanMatch<string, string, "value">;
  };
  readonly "operation.started": { readonly tool?: ToolMatch };
  readonly "operation.finished": { readonly tool?: ToolMatch };
}

type MatchableEventType = keyof EventOptionsByType;

function isMatchableEventType(value: unknown): value is MatchableEventType {
  return value === "message" || value === "operation.started" || value === "operation.finished";
}

function messageEventResult(
  event: Extract<MatchableEvent, { readonly type: "message" }>,
  role: "assistant" | "user" | undefined,
  text: BooleanMatch<string, string, "value"> | undefined,
): Promise<BooleanMatchEvaluation<unknown>> {
  return evaluateFields([
    ...(role === undefined
      ? []
      : [
          {
            label: "role",
            evaluate: async () =>
              event.role === role
                ? matched(event, diagnostic("message-role-match", "message role matched", { expected: role }))
                : mismatched(
                    diagnostic("message-role-mismatch", "message role did not match", {
                      expected: role,
                      received: event.role,
                    }),
                  ),
          },
        ]),
    ...(text === undefined
      ? []
      : [{ label: "text", evaluate: () => evaluateBooleanMatch(text, event.text) }]),
  ]).then((fields) => combineConjunction(event, "eventMatch(message)", fields));
}

async function toolEventResult(event: MatchableEvent, match: ToolMatch | undefined): Promise<BooleanMatchEvaluation<unknown>> {
  if (match === undefined) return matched(event, diagnostic("event-type-match", "event type matched"));
  const occurrence = assertionEventOccurrence(event);
  if (occurrence === undefined) {
    return unavailable(
      "event-tool-occurrence-unavailable",
      diagnostic("event-tool-occurrence-unavailable", "operation event has no associated logical tool occurrence", {
        reason: "event-tool-occurrence-unavailable",
      }),
    );
  }
  return evaluateBooleanMatch(match, occurrence);
}

export function eventMatch<K extends keyof EventOptionsByType>(
  type: K,
  options?: EventOptionsByType[K],
): EventMatch<Extract<AssertionEvent, { readonly type: K }>> {
  if (!isMatchableEventType(type)) throw new TypeError("eventMatch() type is not supported");

  if (type === "message") {
    const normalized = assertPlainOptions(options, "eventMatch(message) options", ["role", "text"]);
    const role = normalized.role;
    if (role !== undefined && role !== "assistant" && role !== "user") {
      throw new TypeError("eventMatch(message) options.role must be assistant or user");
    }
    const text = normalized.text;
    if (text !== undefined) assertBooleanMatch(text, "eventMatch(message) options.text", "value");
    const name = "eventMatch(message)";
    return createBooleanMatch("event", name, async (event) => {
      if (event.type !== "message") {
        return mismatched(diagnostic("event-type-mismatch", "event type did not match", { expected: "message" }));
      }
      return messageEventResult(
        event,
        role as "assistant" | "user" | undefined,
        text as BooleanMatch<string, string, "value"> | undefined,
      ) as Promise<BooleanMatchEvaluation<Extract<AssertionEvent, { readonly type: K }>>>;
    }) as EventMatch<Extract<AssertionEvent, { readonly type: K }>>;
  }

  const normalized = assertPlainOptions(options, `eventMatch(${type}) options`, ["tool"]);
  const tool = normalized.tool;
  if (tool !== undefined) assertBooleanMatch(tool, `eventMatch(${type}) options.tool`, "tool");
  const name = `eventMatch(${type})`;
  return createBooleanMatch("event", name, async (event) => {
    if (event.type !== type) {
      return mismatched(diagnostic("event-type-mismatch", "event type did not match", { expected: type }));
    }
    const fields = await evaluateFields([
      { label: "tool", evaluate: () => toolEventResult(event, tool as ToolMatch | undefined) },
    ]);
    return combineConjunction<AssertionEvent, Extract<AssertionEvent, { readonly type: K }>>(
      event,
      name,
      fields,
    );
  }) as EventMatch<Extract<AssertionEvent, { readonly type: K }>>;
}
