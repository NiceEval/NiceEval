import { defineScoreEval } from "niceeval";
import { defineScoreMatch, defineValueMatch, equals, includes } from "niceeval/expect";

const completion = defineScoreMatch({ name: "completion-ratio", score: (ratio: number) => ratio });

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
      t.check(0, defineScoreMatch({ name: "record-only measurement", score: () => { throw new Error("Measurement unavailable in this fixture"); } }))
        .label("unavailable measurement is only recorded");
      t.check(0, defineValueMatch({ name: "record-only condition", evaluate: () => { throw new Error("Condition unavailable in this fixture"); } }))
        .label("unavailable condition is only recorded");
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
    await t.check(0.25, completion).score(4).orStop(0.7);
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

const gated = defineScoreEval({
  description: "质量门失败保留连续贡献，门槛与计分的配置顺序等价",
  async test(t) {
    const accepted = t.check(0.75, completion).score(20).gate(0.7).label("quality accepted");
    for (const args of [[undefined], [NaN], [0.7, 0.8]]) {
      let invalidStopRejected = false;
      try { Reflect.apply(accepted.orStop, accepted, args); }
      catch (error) { invalidStopRejected = error instanceof TypeError; }
      if (!invalidStopRejected) throw new Error("Invalid stop arguments must be rejected before configuring stop");
    }
    const ready = accepted.orStop();
    if (accepted.orStop() !== ready) throw new Error("Repeated waiting must reuse the same stop Promise");
    let lateLabelRejected = false;
    try { accepted.label("late label must not replace quality accepted"); }
    catch { lateLabelRejected = true; }
    if (!lateLabelRejected) throw new Error("orStop must synchronously close the entry configuration window");
    await ready;
    const fact = t.check("actual", equals("expected"));
    let booleanMinimumRejected = false;
    try { Reflect.apply(fact.orStop, fact, [0.7]); }
    catch (error) { booleanMinimumRejected = error instanceof TypeError; }
    if (!booleanMinimumRejected) throw new Error("Boolean stop must reject a measurement minimum");
    fact.gate().score(3).label("required fact failed");
    await t.check(0.75, completion).gate(0.8).score(20).label("quality below minimum").orStop();
    t.score(100).label("unreachable score");
  },
});

const unavailableGate = defineScoreEval({
  description: "无法评估必要条件时保留已有分数并报告错误",
  test(t) {
    t.score(2).label("score before unavailable gate");
    t.check(0, defineValueMatch({ name: "required condition", evaluate: () => { throw new Error("Required condition cannot be evaluated"); } }))
      .gate().label("required condition unavailable");
  },
});

export default { empty, gated, scored, skipped, stopped, unavailableGate };
