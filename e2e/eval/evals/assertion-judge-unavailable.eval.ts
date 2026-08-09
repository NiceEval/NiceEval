import { defineEval } from "niceeval";

export default defineEval({
  description: "未配置 Judge 时 optional 断言保留 unavailable 证据而不触发网络或改变 verdict",
  async test(t) {
    const turn = await t.send("assertion/judge");
    await turn.succeeded().gate().stopOnFailure();

    // No Judge model is configured in niceeval.config.ts. The three public
    // entrypoints must become recorded optional unavailable evidence; this is
    // the stable no-key branch. A successful paid-model score is not automated.
    turn.judge.autoevals.closedQA("回复是否含确定性 marker？").optional();
    t.judge.autoevals.factuality("assertion-judge-marker", { on: turn.message }).optional();
    t.judge.autoevals.summarizes("assertion-judge-marker", { on: turn.message }).optional();
  },
});
