import { defineAdapter, defineJudge } from "niceeval";
import { TypesafeProvider } from "niceeval/judge";

export const typesafeApplication = defineAdapter({
  name: "typesafe-judge",
  create: () => ({ answer: () => "Paris" }),
});
const quality = defineJudge({
  name: "nonuniform-quality",
  rubric: "Rate the answer.",
  anchors: [
    { measurement: 0, description: "Incorrect" },
    { measurement: 0.2, description: "Partial" },
    { measurement: 1, description: "Complete" },
  ],
});
const wideScale = defineJudge({
  name: "eleven-level-quality",
  rubric: "Rate the answer.",
  anchors: Array.from({ length: 11 }, (_, index) => ({ measurement: index / 10, description: `Level ${index}` })),
});

export default typesafeApplication.defineScoreEval({
  judge: TypesafeProvider({ model: "jev-fixture", baseUrl: process.env.NICEEVAL_E2E_TYPESAFE_URL }),
  test(t) {
    const output = t.answer();
    t.check(output, quality).score(10).label("Nonuniform score");
    t.factuality({ input: "Capital?", output, expected: "Paris" }).score(10).label("Classification");
    t.instructionFollowing({ instructions: ["Name the capital", "Explain why"], output }).score(10).label("Batch");
    t.faithfulness({ input: "Capital?", output, context: "Paris is the capital." }).score(10).label("Unsupported extraction");
    t.check(output, wideScale).score(10).label("Unsupported anchors");
  },
});
