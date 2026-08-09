import { defineEval } from "niceeval";
import { satisfies, includes } from "niceeval/expect";

export default defineEval({
  description: "usage 的输入与输出 token 逐轮可读",
  async test(t) {
    const first = await t.send(
      "9 乘以 7 等于多少?先说明简短的推理过程,再给出最终数字。不要调用工具。",
    );
    await t.require(first.succeeded());
    const second = await t.send("把刚才的最终数字再说一遍。不要调用工具。");
    await t.require(second.succeeded());

    await t.group("每一轮都有正的 inputTokens 与 outputTokens", () => {
      for (const [label, turn] of [
        ["first", first],
        ["second", second],
      ] as const) {
        t.assert(
          t.check(
            turn.usage?.inputTokens,
            satisfies(
              `${label}.usage.inputTokens > 0`,
              (value) => typeof value === "number" && value > 0,
            ),
          ),
        );
        t.assert(
          t.check(
            turn.usage?.outputTokens,
            satisfies(
              `${label}.usage.outputTokens > 0`,
              (value) => typeof value === "number" && value > 0,
            ),
          ),
        );
      }
    });
    t.assert(t.check(second.message, includes("63")));
  },
});
