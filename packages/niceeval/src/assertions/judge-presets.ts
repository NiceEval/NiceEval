import { defineBuiltinScoreMatch } from "./builtin-score-match.ts";
import {
  FACTUALITY_RUBRIC,
  FAITHFULNESS_EXTRACT,
  FAITHFULNESS_CLASSIFY,
  INSTRUCTION_RUBRIC,
  PREFERENCE_RUBRIC,
} from "./judge-presets.prompt.ts";
import { Effect, Predicate, Schema } from "effect";
import { type ManagedScoreMatchOptions, type ScoreMatch } from "./match.ts";

/** Shared resource limits for the fixed Judge presets. */
export interface JudgePresetOptions {
  readonly maxCalls?: number | undefined;
  readonly maxMaterialBytes?: number | undefined;
}

/** Supplies the question, candidate and reference for factuality scoring; expected is the author's reference rather than independently verified truth. */
export interface FactualityMaterial {
  readonly input: string;
  readonly output: string;
  readonly expected: string;
}
/** Supplies candidate claims and their supporting context; faithfulness uses that context rather than outside knowledge. */
export interface FaithfulnessMaterial {
  readonly input: string;
  readonly output: string;
  readonly context: string | readonly string[];
}
/** Supplies nonempty instructions and the output to check against every instruction. */
export interface InstructionFollowingMaterial {
  readonly instructions: readonly string[];
  readonly output: string;
}
/** Supplies instructions, candidate output and comparison reference; the resulting score expresses preference rather than a win probability. */
export interface PairwisePreferenceMaterial {
  readonly instructions: string;
  readonly output: string;
  readonly reference: string;
}
const text = Schema.String.check(Schema.isPattern(/\S/u));
const factualityMaterial = Schema.Struct({ input: text, output: text, expected: text });
const faithfulnessMaterial = Schema.Struct({
  input: text,
  output: text,
  context: Schema.Union([text, Schema.Array(text).check(Schema.isMinLength(1))]),
});
const instructionMaterial = Schema.Struct({
  instructions: Schema.Array(text).check(Schema.isMinLength(1)),
  output: text,
});
const preferenceMaterial = Schema.Struct({ instructions: text, output: text, reference: text });
const decodeOptions = { onExcessProperty: "error" as const };
const classificationBatchSize = 32;
const faithfulnessContinuation = "Continue the extraction. Return only claims not in the already extracted claims.";

export function optionsFor(
  defaultName: string,
  options: JudgePresetOptions,
): {
  readonly name: string;
  readonly llm: ManagedScoreMatchOptions<unknown>["llm"];
} {
  if (!Predicate.isObject(options) || Array.isArray(options))
    throw new TypeError("Judge preset options must be an object");
  const captured: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string" || !["maxCalls", "maxMaterialBytes"].includes(key)) {
      throw new TypeError("Judge preset options contain an unknown property");
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError("Judge preset options must be data properties");
    captured[key] = descriptor.value;
  }
  const limits: { maxCalls?: number; maxMaterialBytes?: number } = {};
  for (const key of ["maxCalls", "maxMaterialBytes"] as const) {
    const value = captured[key];
    if (value === undefined) continue;
    if (typeof value !== "number") throw new TypeError(`Judge preset ${key} must be a number`);
    limits[key] = value;
  }
  return { name: defaultName, llm: limits };
}

/** Classifies consistency with a supplied reference: consistent=1, incomplete=0.5, contradictory=0. */
export function factuality(options: JudgePresetOptions = {}): ScoreMatch<FactualityMaterial> {
  return defineBuiltinScoreMatch<FactualityMaterial>({
    ...optionsFor("factuality", options),
    config: { rubric: FACTUALITY_RUBRIC, scores: { consistent: 1, incomplete: 0.5, contradictory: 0 } },
    score: (value, ctx) =>
      Effect.gen(function* () {
        const material = Schema.decodeUnknownSync(factualityMaterial, decodeOptions)(value);
        const result = yield* ctx.llm.classify({
          rubric: FACTUALITY_RUBRIC,
          choices: ["consistent", "incomplete", "contradictory"],
          material,
        });
        function factualityMeasurement(): number {
          switch (result.choice) {
            case "consistent":
              return 1;
            case "incomplete":
              return 0.5;
            default:
              return 0;
          }
        }
        return {
          state: "measured" as const,
          measurement: factualityMeasurement(),
          rationale: result.rationale,
        };
      }),
  });
}

/** Extracts claims and computes the fraction supported by context; an empty extraction is unavailable. */
export function faithfulness(options: JudgePresetOptions = {}): ScoreMatch<FaithfulnessMaterial> {
  const declared = optionsFor("faithfulness", options);
  return defineBuiltinScoreMatch<FaithfulnessMaterial>(
    {
      ...declared,
      config: {
        extract: FAITHFULNESS_EXTRACT,
        continuation: faithfulnessContinuation,
        classify: FAITHFULNESS_CLASSIFY,
        batchSize: classificationBatchSize,
        scores: { supported: 1, unsupported: 0 },
        aggregation: "supported/total",
        empty: "unavailable",
      },
      score: (value, ctx) =>
        Effect.gen(function* () {
          const material = Schema.decodeUnknownSync(faithfulnessMaterial, decodeOptions)(value);
          const claims = new Set<string>();
          let calls = 0;
          const maxCalls = declared.llm.maxCalls;
          const exhausted = (unclassified: number, extractionIncomplete: boolean) => ({
            state: "unavailable" as const,
            reason: "score-match-call-budget",
            rationale:
              `Used ${calls}/${maxCalls} LLM calls with ${unclassified} unclassified claims.` +
              (extractionIncomplete ? " Claim extraction is incomplete." : ""),
          });
          const input = { input: material.input, output: material.output };
          let complete: boolean;
          let rationale: string;
          do {
            if (calls === maxCalls) return exhausted(claims.size, true);
            const extraction = yield* ctx.llm.extract({
              rubric: calls === 0 ? FAITHFULNESS_EXTRACT : `${FAITHFULNESS_EXTRACT}\n${faithfulnessContinuation}`,
              material: calls === 0 ? input : { ...input, alreadyExtracted: [...claims] },
            });
            calls++;
            for (const claim of extraction.items) claims.add(claim);
            complete = extraction.complete;
            rationale = extraction.rationale;
          } while (!complete);
          if (claims.size === 0) return { state: "unavailable" as const, reason: "no-claims", rationale };

          const items = Array.from(claims, (claim, index) => ({ id: String(index + 1), text: claim }));
          const context = {
            input: material.input,
            context: typeof material.context === "string" ? material.context : [...material.context],
          };
          let supported = 0;
          for (let start = 0; start < items.length; start += classificationBatchSize) {
            if (calls === maxCalls) return exhausted(items.length - start, false);
            const result = yield* ctx.llm.batchClassify({
              rubric: FAITHFULNESS_CLASSIFY,
              choices: ["supported", "unsupported"],
              items: items.slice(start, start + classificationBatchSize),
              material: context,
            });
            calls++;
            supported += result.items.filter((item) => item.choice === "supported").length;
          }
          return {
            state: "measured" as const,
            measurement: supported / items.length,
            rationale: `${supported}/${items.length} extracted claims are supported by the supplied context.`,
          };
        }),
    },
    false,
  );
}

/** Computes the fraction of the author's explicit instructions fulfilled by the output. */
export function instructionFollowing(options: JudgePresetOptions = {}): ScoreMatch<InstructionFollowingMaterial> {
  return defineBuiltinScoreMatch<InstructionFollowingMaterial>({
    ...optionsFor("instruction-following", options),
    config: {
      rubric: INSTRUCTION_RUBRIC,
      scores: { followed: 1, "not-followed": 0 },
      aggregation: "followed/total",
      batchSize: classificationBatchSize,
    },
    score: (value, ctx) =>
      Effect.gen(function* () {
        const material = Schema.decodeUnknownSync(instructionMaterial, decodeOptions)(value);
        const items = material.instructions.map((instruction, index) => ({ id: String(index + 1), text: instruction }));
        let followed = 0;
        for (let start = 0; start < items.length; start += classificationBatchSize) {
          const result = yield* ctx.llm.batchClassify({
            rubric: INSTRUCTION_RUBRIC,
            choices: ["followed", "not-followed"],
            items: items.slice(start, start + classificationBatchSize),
            material: { output: material.output },
          });
          followed += result.items.filter((item) => item.choice === "followed").length;
        }
        return {
          state: "measured" as const,
          measurement: followed / items.length,
          rationale: `${followed}/${items.length} explicit instructions are fulfilled.`,
        };
      }),
  });
}

/** Compares candidate output with reference: candidate wins=1, tie=0.5, reference wins=0. */
export function pairwisePreference(options: JudgePresetOptions = {}): ScoreMatch<PairwisePreferenceMaterial> {
  return defineBuiltinScoreMatch<PairwisePreferenceMaterial>({
    ...optionsFor("pairwise-preference", options),
    config: { rubric: PREFERENCE_RUBRIC, scores: { candidate: 1, tie: 0.5, reference: 0 } },
    score: (value, ctx) =>
      Effect.gen(function* () {
        const material = Schema.decodeUnknownSync(preferenceMaterial, decodeOptions)(value);
        const result = yield* ctx.llm.classify({
          rubric: PREFERENCE_RUBRIC,
          choices: ["candidate", "tie", "reference"],
          material,
        });
        function preferenceMeasurement(): number {
          switch (result.choice) {
            case "candidate":
              return 1;
            case "tie":
              return 0.5;
            default:
              return 0;
          }
        }
        return {
          state: "measured" as const,
          measurement: preferenceMeasurement(),
          rationale: result.rationale,
        };
      }),
  });
}
