import { defineScoreEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

export default defineScoreEval({
  description: "计分制句柄把 points、gate、soft、optional 与直接给分写入真实结果",
  async test(t) {
    const turn = await t.send("assertion/score");
    await turn.succeeded().points(1).gate().stopOnFailure();

    await t.group("计分断言", () => {
      turn.messageIncludes("assertion-score-marker").points(2);
      t.check(turn.data, equals({ fixture: "assertion-score", ok: true })).points(3);
      t.check(turn.message, includes("assertion-score-marker")).atLeast(1);
      t.check(turn.message, includes("assertion-score-marker")).soft();
      t.check(turn.message, includes("assertion-score-marker")).optional();
      t.score("deterministic manual points", 4);
    });
  },
});
