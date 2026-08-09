import { defineScoreEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

export default defineScoreEval({
  description: "计分制 Fact 把前置、按事实计分与直接给分写入真实结果",
  async test(t) {
    const turn = await t.send("assertion/score");
    const completed = turn.succeeded();
    t.score("turn completed", completed, { max: 1 });
    await t.require(completed);

    await t.group("计分断言", () => {
      const marker = t.check(turn.message, includes("assertion-score-marker"));
      const result = t.check(
        turn.data,
        equals({ fixture: "assertion-score", ok: true }),
      );

      t.score("reply marker", marker, { max: 2 });
      t.score("fixture data", result, { max: 3 });
      t.score("deterministic manual points", { earned: 4 });
    });

    return t.finishScore();
  },
});
