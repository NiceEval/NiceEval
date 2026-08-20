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

const stopped = defineScoreEval({
  description: "orStop 只停止当前计分 continuation，并保留已得分",
  async test(t) {
    t.score(2).label("score before stop");
    await t.check("actual", equals("expected")).score(3).orStop();
    t.score(100).label("unreachable score");
  },
});

const skipped = defineScoreEval({
  description: "显式跳过的计分 Eval 不参加排名",
  test(t) {
    t.score(9).label("score before skip");
    t.skip("fixture intentionally does not participate");
  },
});

export default { empty, scored, skipped, stopped };
