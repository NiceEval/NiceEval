import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";

export default defineEval({
  description: "usage 的输入与输出 token 逐轮可读",
  async test(t) {
    const first = await t.send("9 乘以 7 等于多少?先说明简短的推理过程,再给出最终数字。不要调用工具。");
    await first.succeeded().stopOnFailure();
    const second = await t.send("把刚才的最终数字再说一遍。不要调用工具。");
    await second.succeeded().stopOnFailure();

    await t.group("每一轮都有正的 inputTokens 与 outputTokens", () => {
      for (const [label, turn] of [["first", first], ["second", second]] as const) {
        t.check(
          turn.usage?.inputTokens,
          satisfies((value) => typeof value === "number" && value > 0, `${label}.usage.inputTokens > 0`),
        );
        t.check(
          turn.usage?.outputTokens,
          satisfies((value) => typeof value === "number" && value > 0, `${label}.usage.outputTokens > 0`),
        );
      }
    });
    second.messageIncludes("63");
  },
});
