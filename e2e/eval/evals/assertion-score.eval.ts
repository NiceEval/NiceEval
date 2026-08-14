import { defineScoreEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

const scored = defineScoreEval({
  description: "计分制 Assertion 把前置、按检查计分与直接给分写入真实结果",
  async test(t) {
    const turn = await t.send("assertion/score");
    turn.succeeded()
      .score(1)
      .label("turn completed");

    await t.group("计分断言", () => {
      const marker = t.check(turn.message, includes("assertion-score-marker"));
      const result = t.check(
        turn.data,
        equals({ fixture: "assertion-score", ok: true }),
      );

      marker.score(2).label("reply marker");
      result.score(3).label("fixture data");
      t.check(turn.message, includes("deliberately-absent"))
        .score(5)
        .label("mismatch contributes zero without failing");
      t.score(4).label("deterministic manual points");
    });
  },
});

const empty = defineScoreEval({
  description: "没有分值贡献的计分制 Eval 正常得到零分",
  test() {},
});

export default { empty, scored };
