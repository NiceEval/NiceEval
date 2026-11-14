// @concord-file
// @concord-implements docs/feature/judge/library.md
// @concord-implements docs/feature/judge/architecture.md

import { Predicate } from "effect";
import type { JudgeAnchor } from "./judge.ts";
import { judgeMaterialBudget, judgeRubricAndAnchors } from "./judge-definition.ts";

/** Configures one reviewer for conversational scoring in the Attempt's exclusive Sandbox. */
export interface AgentJudgeDefinition {
  readonly instructions?: string;
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
  readonly maxMaterialBytes?: number;
}
declare const agentJudgeBrand: unique symbol;
/** Immutable reviewer created by defineAgentJudge. Open a conversation with t.agentJudge. */
export interface AgentJudge {
  readonly [agentJudgeBrand]: true;
}
/** Queues conversational messages and independently scored questions in author order. */
export interface AgentJudgeReview<Kind extends import("./api.ts").AssertionEvaluationKind = "pass" | "score"> {
  judge(criterion: string): import("./api.ts").MeasurementAssertionHandle<Kind>;
  grade(
    prompt: string,
    options: { readonly anchors: readonly JudgeAnchor[] },
  ): import("./api.ts").MeasurementAssertionHandle<Kind>;
  chat(message: string): void;
}
export interface NormalizedAgentJudge {
  readonly instructions: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly maxMaterialBytes?: number;
}
const definitions = new WeakMap<object, NormalizedAgentJudge>();
/** @internal Validates the opaque reviewer without reading consumer properties. */
export function agentJudgeDefinitionOf(value: unknown): NormalizedAgentJudge {
  const definition = Predicate.isObject(value) ? definitions.get(value) : undefined;
  if (definition === undefined) throw new TypeError("agentJudge() requires a reviewer created by defineAgentJudge()");
  return definition;
}

function dataObject(value: unknown, label: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || (allowed !== undefined && !allowed.includes(key)))
      throw new TypeError(`${label} has unknown option ${String(key)}`);
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !("value" in property))
      throw new TypeError(`${label}.${key} must be a data property`);
    result[key] = property.value;
  }
  return result;
}

function positive(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

/** Defines an immutable reviewer; questions and score policies are registered at the call site. */
export function defineAgentJudge(definition: AgentJudgeDefinition): AgentJudge {
  const input = dataObject(definition, "defineAgentJudge() options", [
    "instructions",
    "maxTurns",
    "timeoutMs",
    "maxMaterialBytes",
  ]);
  judgeMaterialBudget(input.maxMaterialBytes);
  if (
    input.instructions !== undefined &&
    (typeof input.instructions !== "string" ||
      input.instructions.trim() === "" ||
      new TextEncoder().encode(input.instructions).byteLength > 8192)
  ) {
    throw new TypeError("Agent Judge instructions must be non-empty and at most 8192 UTF-8 bytes");
  }
  const normalized: NormalizedAgentJudge = Object.freeze({
    instructions: (input.instructions as string | undefined) ?? "",
    maxTurns: positive(input.maxTurns, 40, "Agent Judge maxTurns"),
    timeoutMs: positive(input.timeoutMs, 600_000, "Agent Judge timeoutMs"),
    ...(input.maxMaterialBytes === undefined
      ? {}
      : { maxMaterialBytes: positive(input.maxMaterialBytes, 1, "Agent Judge maxMaterialBytes") }),
  });
  const reviewer = Object.freeze({}) as AgentJudge;
  definitions.set(reviewer, normalized);
  return reviewer;
}
/** @internal Validates the question and snapshots explicit grade anchors. */
export function agentJudgeQuestion(
  kind: "judge" | "grade",
  prompt: string,
  options?: { readonly anchors: readonly JudgeAnchor[] },
) {
  const input = options === undefined ? {} : dataObject(options, "Agent Judge question options", ["anchors"]);
  if (kind === "grade" && input.anchors === undefined) throw new TypeError("Agent Judge grade requires anchors");
  if (kind === "judge" && options !== undefined) throw new TypeError("Agent Judge judge accepts only a criterion");
  const question = judgeRubricAndAnchors(prompt, kind === "grade" ? input.anchors : undefined);
  // Match config capture sorts object keys; preserve that observable anchor order.
  const anchors = Object.freeze(
    question.anchors.map(({ description, measurement }) =>
      Object.freeze({ description, measurement: Object.is(measurement, -0) ? 0 : measurement }),
    ),
  );
  return { rubric: question.rubric, anchors: kind === "grade" ? anchors : null };
}
