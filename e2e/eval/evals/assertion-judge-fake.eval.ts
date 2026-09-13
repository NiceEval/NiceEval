import { defineAdapter, defineJudge } from "niceeval";

const judging = defineJudge({
  name: "niceeval.e2e.marker-quality/v1",
  rubric: "Measure whether the reply satisfies the marker criterion.",
  anchors: [
    { measurement: 0, description: "does not contain the marker" },
    { measurement: 0.5, description: "contains only part of the marker" },
    { measurement: 1, description: "contains the complete marker" },
  ],
});

export const markerApplication = defineAdapter({
  name: "judge-marker-application",
  create() {
    return {
      post() {
        return { id: "post-1", content: `original-marker:${"x".repeat(9_000)}:LAST_MATERIAL_SENTINEL` };
      },
    };
  },
});

export default markerApplication.defineScoreEval({
  description: "应用对象由 Judge 判分，登记时的完整材料与理由可以公开读回",
  judge: judging,
  async test(t) {
    const post = t.post();
    t.check({ task: "Check the complete marker", post }, judging)
      .gate(0.7)
      .score(20)
      .label("Judge marker");
    t.judge({ task: "Check the complete marker", post }, judging)
      .score(20)
      .gate(0.8)
      .label("Judge sugar");
    // Mutation after registration must not change the bytes sent to the Judge.
    post.content = "MUTATED_AFTER_REGISTRATION";
  },
});
