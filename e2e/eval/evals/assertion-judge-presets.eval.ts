import { Effect } from "effect";
import {
  defineAdapter,
  defineJudge,
} from "niceeval";
import { defineScoreMatch, type ScoreMatch } from "niceeval/expect";

const limits = { maxAuditBytes: 40 * 1024 };
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
  judge: "judge-eval-override",
  test(t) {
    const output = t.answer();
    t.factuality({ input: "Describe Paris", output, expected: "Paris is the capital of France and has museums." }, limits)
      .score(10).label("Factuality");
    t.faithfulness({ input: "Describe Paris", output, context: "Paris is the capital of France and has museums." }, limits)
      .gate(0.7).score(30).label("Faithfulness");
    t.instructionFollowing({ instructions: ["Name the capital", "Avoid unsupported locations"], output }, limits)
      .score(20).label("Instructions");
    t.pairwisePreference({ instructions: "Explain clearly", output, reference: "Paris is the capital of France." }, limits)
      .score(10).label("Preference");
    t.check({ output }, ordinaryMatch).score(10).label("Quality");
    t.closeQA({ input: "unanswerable", output: "The context does not say.", context: "Paris is in France." }, limits)
      .score(2).label("Close QA refusal");
    t.closeQA({ input: "partial", output: "Paris", context: "France: Paris; Italy: Rome." }, limits)
      .score(2).label("Close QA partial");
    t.closeQA({ input: "unsupported", output: "Paris is on Mars.", context: "Paris is in France." }, limits)
      .score(2).label("Close QA incorrect");
    const customMaterial = { output: "ORIGINAL_CUSTOM_MARKER" };
    t.check(customMaterial, custom).score(20).label("Custom");
    customMaterial.output = "MUTATED_AFTER_CHECK";
  },
});
