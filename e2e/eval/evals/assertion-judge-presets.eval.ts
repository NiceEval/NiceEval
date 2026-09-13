import { Effect } from "effect";
import {
  defineAdapter,
  defineJudge,
  factuality,
  faithfulness,
  instructionFollowing,
  pairwisePreference,
} from "niceeval";
import { defineScoreMatch, type ScoreMatch } from "niceeval/expect";

const limits = { maxAuditBytes: 64 * 1024 };
const factual = factuality(limits);
const faithful = faithfulness(limits);
const follows = instructionFollowing(limits);
const preference = pairwisePreference(limits);
const quality = defineJudge({ name: "style-quality", rubric: "Rate the clarity of the answer.", ...limits });
// A Judge is a ScoreMatch, not a separate kind accepted by another check overload.
const ordinaryMatch: ScoreMatch<unknown> = quality;

export const judgePresetApplication = defineAdapter({
  name: "judge-preset-application",
  create: () => ({ answer: () => "Paris is the capital of France. It has museums. It is on Mars." }),
});

const custom = defineScoreMatch<{ output: string }>({
  name: "custom-acceptance",
  version: "1",
  config: { accepted: 0.8, rejected: 0 },
  llm: limits,
  score: (value, ctx) => Effect.gen(function* () {
    const result = yield* ctx.llm.classify({ rubric: "Accept the original output marker.", choices: ["accepted", "rejected"], material: value });
    return result.choice === "accepted" ? 0.8 : 0;
  }),
});

export default judgePresetApplication.defineScoreEval({
  description: "Inspect a combined rubric with classified, decomposed, comparative and free-form scores",
  judge: [factual, faithful, follows, preference, quality, custom],
  test(t) {
    const output = t.answer();
    t.check({ input: "Describe Paris", output, expected: "Paris is the capital of France and has museums." }, factual)
      .score(10).label("Factuality");
    t.check({ input: "Describe Paris", output, context: "Paris is the capital of France and has museums." }, faithful)
      .gate(0.7).score(30).label("Faithfulness");
    t.check({ instructions: ["Name the capital", "Avoid unsupported locations"], output }, follows)
      .score(20).label("Instructions");
    t.judge({ instructions: "Explain clearly", output, reference: "Paris is the capital of France." }, preference)
      .score(10).label("Preference");
    t.check({ output }, ordinaryMatch).score(10).label("Quality");
    const customMaterial = { output: "ORIGINAL_CUSTOM_MARKER" };
    t.check(customMaterial, custom).score(20).label("Custom");
    customMaterial.output = "MUTATED_AFTER_CHECK";
  },
});
