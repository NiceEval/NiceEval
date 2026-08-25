import { defineScoreEval } from "niceeval";
import { defineScoreMatch, equals, includes, satisfies } from "niceeval/expect";

const eventGallery = [
  { type: "message", role: "user", text: "Inspect the fixed View." },
  { type: "subagent.completed", name: "inspection-reviewer" },
] as const;

export default defineScoreEval({
  description: "inspection: 生成稳定的 Verdict、Score、coverage 与 Evidence",
  async test(t) {
    await t.send("produce deterministic inspection evidence");
    t.check("inspection-fixture", equals("inspection-fixture"))
      .score(34.111111111111114)
      .label("Compact score contribution");
    t.check("inspection-fixture", includes("never-present"))
      .score(5)
      .label("Mismatched Boolean contributes zero");
    t.check("inspection-fixture", defineScoreMatch({
      name: "inspection measurement",
      score: (value: string) => value === "inspection-fixture" ? 0.75 : 0,
    }).atLeast(0.5)).score(4).label("Measurement contributes three points");
    t.check(
      eventGallery,
      satisfies("inspection lifecycle exists", (items: typeof eventGallery) =>
        items.some((event) => event.type === "subagent.completed")
      ),
    ).label("Collection evidence remains bounded");
  },
});
