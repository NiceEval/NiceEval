// 协议行为:message_end 的 AssistantMessage.usage 逐轮累加进 Turn.usage(见
// fromPiAgentEvents);工具执行真实抛错时(除以零算出 Infinity,被 Number.isFinite 挡下来
// 真实抛出,见 src/tools.ts 的 calculate)如实归一成 action.result status "failed",
// 不折成一条看起来正常的助手消息、也不能和 agent 自己编的数字混在一起。
import { defineEval } from "niceeval";
import { isDefined, satisfies } from "niceeval/expect";

export default defineEval({
  description: "usage 逐轮进入 Turn;工具执行失败如实归一成 failed,agent 不编造结果",
  async test(t) {
    const ok = await t.send("帮我算一下 (3+4)*2,调用 calculate 工具求值。");
    ok.succeeded();
    ok.calledTool("calculate", { status: "completed" });
    t.check(ok.usage, isDefined("pi-agent-core 的 message_end 带 usage,adapter 应逐轮归一进 Turn.usage"));
    t.check(
      ok.usage?.inputTokens,
      satisfies((v) => typeof v === "number" && v > 0, "usage.inputTokens 应为正数"),
    );

    const fail = await t.send(
      '调用 calculate 工具,把 expression 参数原样设为字符串 "7/0",直接调用,不要自己先心算、也不要改写表达式;如果工具报错,如实告诉我失败原因,不要编造一个数值结果。',
    );
    fail.succeeded(); // 助手这一轮仍正常收尾(如实汇报失败),不是 Turn 级失败
    fail.calledTool("calculate", { input: { expression: "7/0" }, status: "failed" });
    fail.notCalledTool("calculate", { status: "completed" });
  },
});
