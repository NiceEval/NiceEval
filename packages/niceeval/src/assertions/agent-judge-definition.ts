// @concord-file
// @concord-implements docs/feature/judge/library.md
// @concord-implements docs/feature/judge/architecture.md

import { Predicate } from "effect";
import { defineJudge, type JudgeAnchor } from "./judge.ts";
import { managedScoreMatchOf } from "./match.ts";

/** Configures one reviewer for conversational scoring in the Attempt's exclusive Sandbox. */
export interface AgentJudgeDefinition {
  readonly name: string;
  readonly instructions?: string;
  readonly anchors?: readonly JudgeAnchor[];
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
  readonly maxMaterialBytes?: number;
  readonly maxAuditBytes?: number;
}
declare const agentJudgeBrand: unique symbol;
/** Immutable reviewer created by defineAgentJudge. Open a conversation with t.agentJudge. */
export interface AgentJudge { readonly [agentJudgeBrand]: true }
/** Queues conversational messages and independently scored questions in author order. */
export interface AgentJudgeReview<Kind extends import("./api.ts").AssertionEvaluationKind = "pass" | "score"> {
  judge(prompt: string, options?: { readonly anchors?: readonly JudgeAnchor[] }): import("./api.ts").MeasurementAssertionHandle<Kind>;
  chat(message: string): void;
}
export interface NormalizedAgentJudge {
  readonly name: string;
  readonly instructions: string;
  readonly anchors: readonly JudgeAnchor[];
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly maxMaterialBytes: number;
  readonly maxAuditBytes: number;
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
    if (typeof key !== "string" || allowed !== undefined && !allowed.includes(key)) throw new TypeError(`${label} has unknown option ${String(key)}`);
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !("value" in property)) throw new TypeError(`${label}.${key} must be a data property`);
    result[key] = property.value;
  }
  return result;
}

function positive(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

/** Defines an immutable reviewer; questions and score policies are registered at the call site. */
export function defineAgentJudge(definition: AgentJudgeDefinition): AgentJudge {
  const input = dataObject(definition, "defineAgentJudge() options", ["name", "instructions", "anchors", "maxTurns", "timeoutMs", "maxMaterialBytes", "maxAuditBytes"]);
  const validated = managedScoreMatchOf(defineJudge({
    name: input.name as string, rubric: "Review the requested question using Sandbox evidence.",
    ...(input.anchors === undefined ? {} : { anchors: input.anchors as readonly JudgeAnchor[] }),
    ...(input.maxMaterialBytes === undefined ? {} : { maxMaterialBytes: input.maxMaterialBytes as number }),
    maxAuditBytes: input.maxAuditBytes === undefined ? 4 * 1024 * 1024 : input.maxAuditBytes as number,
  }))!;
  if (input.instructions !== undefined && (typeof input.instructions !== "string" || input.instructions.trim() === "" || new TextEncoder().encode(input.instructions).byteLength > 8192)) {
    throw new TypeError("Agent Judge instructions must be non-empty and at most 8192 UTF-8 bytes");
  }
  const config = validated.config as unknown as { readonly anchors: readonly JudgeAnchor[] };
  const normalized: NormalizedAgentJudge = Object.freeze({
    name: input.name as string, instructions: input.instructions as string | undefined ?? "", anchors: config.anchors,
    maxTurns: positive(input.maxTurns, 40, "Agent Judge maxTurns"),
    timeoutMs: positive(input.timeoutMs, 600_000, "Agent Judge timeoutMs"),
    maxMaterialBytes: positive(input.maxMaterialBytes, 32 * 1024, "Agent Judge maxMaterialBytes"),
    maxAuditBytes: positive(input.maxAuditBytes, 4 * 1024 * 1024, "Agent Judge maxAuditBytes"),
  });
  const reviewer = Object.freeze({}) as AgentJudge;
  definitions.set(reviewer, normalized);
  return reviewer;
}
/** @internal Shares exact prompt/anchor admission with ordinary rubric judges. */
export function agentJudgeQuestion(judge: NormalizedAgentJudge, prompt: string, options?: { readonly anchors?: readonly JudgeAnchor[] }) {
  const input = options === undefined ? {} : dataObject(options, "Agent Judge question options", ["anchors"]);
  const definition = managedScoreMatchOf(defineJudge({ name: judge.name, rubric: prompt, anchors: input.anchors as readonly JudgeAnchor[] | undefined ?? judge.anchors }))!;
  return definition.config as unknown as { readonly rubric: string; readonly anchors: readonly JudgeAnchor[] };
}
