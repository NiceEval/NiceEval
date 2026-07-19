// 协议行为:usage——reasoning 与 usage 逐轮进入 Turn(turn.completed 聚合 usage;
// reasoning item 归一成 thinking 事件,见 src/agents/sdk-streams.ts 的 fromCodexThreadEvents)。
//
// 题目特意选三步算术而不是"9 乘以 7"这类一步心算:真机验证过,一步心算即使
// modelReasoningEffort=high 也常常不产出可总结的 reasoning item(模型内部
// reasoning_output_tokens 时而是 0),thinking 断言会随机失败——不是转换器的问题,是题目
// 太简单,模型没什么可总结的推理过程。三步题(agents/codex-sdk.ts 已把
// modelReasoningEffort 兜底成 "high"、model_reasoning_summary 配成 "detailed")真机验证
// 5/5 次稳定产出 reasoning item。
import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";

export default defineEval({
  description: "usage:reasoning 与 usage 逐轮进入 Turn",
  async test(t) {
    const turn = await t.send(
      "一列火车第一小时行驶 60 公里,第二小时车速比第一小时快 15 公里/小时,第三小时车速比第二小时" +
        "慢 5 公里/小时。先简短说明逐步推理过程,再给出三小时行驶的总公里数(只给最终数字)。",
    );
    turn.expectOk();

    await t.group("usage 逐轮非空", () => {
      t.check(
        turn.usage?.inputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "usage.inputTokens > 0"),
      );
      t.check(
        turn.usage?.outputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "usage.outputTokens > 0"),
      );
    });

    turn.messageIncludes("205");
    turn.event("thinking");
  },
});
