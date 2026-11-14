// @concord-file
// @concord-implements docs/feature/judge/README.md
// @concord-implements docs/feature/judge/library.md
// @concord-implements docs/feature/judge/use-case/verify-judge.md
// @concord-implements docs/feature/judge/use-case/binary-criteria.md
// @concord-implements docs/feature/eval/use-case/judge-quality.md
import { defineBuiltinScoreMatch } from "./builtin-score-match.ts";
import { binaryJudgeRubric } from "./judge-presets.prompt.ts";
import * as Effect from "effect/Effect";
import { type ScoreMatch } from "./match.ts";
import type { JudgeMaterial } from "../judge/image.ts";
import {
  boundedText,
  exactDataObject,
  judgeMaterialBudget,
  judgeRubricAndAnchors,
  positiveInteger,
} from "./judge-definition.ts";

/** Describes a rubric measurement anchor in [0,1]; model measurements may fall between anchors and are not confidence values. */
export interface JudgeAnchor {
  readonly measurement: number;
  readonly description: string;
}
/** Defines a reusable rubric and resource budgets; explicit anchors must increase strictly and include both 0 and 1. */
export interface JudgeOptions {
  readonly rubric: string;
  readonly anchors?: readonly JudgeAnchor[];
  readonly maxMaterialBytes?: number;
  readonly maxCalls?: number;
}
/** A reusable rubric-backed ScoreMatch; gate thresholds and point contributions belong on its assertion handle. */
export type JudgeDefinition = ScoreMatch<unknown>;

/** Configure a binary rubric and Judge budgets; anchors are not accepted. */
export type BinaryJudgeOptions = Omit<JudgeOptions, "anchors">;

export {
  snapshotScoreMatchMaterial,
  snapshotJudgeMaterial,
  projectJudgeMaterial,
  chunkUtf8,
  type CapturedImageReference,
} from "./judge-material-capture.ts";
export {
  errorSummary,
  retryAfterMs,
  isTransportFailure,
  isTransientJudgeFailure,
  interruptibleByCaller,
  responseByteCap,
  requestScoreMatchProvider,
} from "./judge-transport.ts";

/** Defines one immutable scoring standard and returns the managed Match itself. */
export function defineJudge(options: JudgeOptions): JudgeDefinition {
  const input = exactDataObject(options, "defineJudge() options", [
    "rubric",
    "anchors",
    "maxMaterialBytes",
    "maxCalls",
  ]);
  const { rubric, anchors } = judgeRubricAndAnchors(input.rubric, input.anchors);
  const definition = defineBuiltinScoreMatch<unknown>({
    name: "rubric-judge",
    config: { rubric, anchors: anchors.map((anchor) => ({ ...anchor })) },
    llm: {
      ...(input.maxMaterialBytes === undefined
        ? {}
        : { maxMaterialBytes: judgeMaterialBudget(input.maxMaterialBytes) }),
      ...(input.maxCalls === undefined ? {} : { maxCalls: positiveInteger(input.maxCalls, "Judge maxCalls", 16) }),
    },
    score: (material, context) =>
      context.llm
        .score({ rubric, anchors, material: material as JudgeMaterial })
        .pipe(Effect.map((result) => ({ state: "measured" as const, ...result }))),
  });
  return definition;
}
/** Classify explicit material as satisfied (1) or not-satisfied (0); use .gate(1) for a required criterion. */
export function binaryJudge(options: BinaryJudgeOptions): JudgeDefinition {
  const input = exactDataObject(options, "binaryJudge() options", ["rubric", "maxMaterialBytes", "maxCalls"]);
  const rubric = boundedText(input.rubric, "Judge rubric", 8 * 1024);
  const choices = ["satisfied", "not-satisfied"] as const;
  return defineBuiltinScoreMatch<unknown>({
    name: "binary-judge",
    config: {
      algorithm: "binary-classification",
      rubric,
      choices: [...choices],
      scores: { satisfied: 1, "not-satisfied": 0 },
    },
    llm: {
      ...(input.maxMaterialBytes === undefined
        ? {}
        : { maxMaterialBytes: judgeMaterialBudget(input.maxMaterialBytes) }),
      ...(input.maxCalls === undefined ? {} : { maxCalls: positiveInteger(input.maxCalls, "Judge maxCalls", 16) }),
    },
    score: (material, context) =>
      context.llm.classify({ rubric: binaryJudgeRubric(rubric), choices, material: material as JudgeMaterial }).pipe(
        Effect.map((result) => ({
          state: "measured" as const,
          measurement: result.choice === "satisfied" ? 1 : 0,
          rationale: result.rationale,
        })),
      ),
  });
}
