import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";

export default defineEval({
  description: "usage 的输入与输出 token 在每个独立 turn 都可读",
  async test(t) {
    const first = await t
      .newSession()
      .send("只回答数字: 2 加 3 等于几?不要调用任何工具。");
    await t.require(first.succeeded());

    const second = await t
      .newSession()
      .send("只回答数字: 7 减 4 等于几?不要调用任何工具。");
    await t.require(second.succeeded());

    for (const [label, turn] of [
      ["first", first],
      ["second", second],
    ] as const) {
      await t.group(`${label} turn 的实际 usage`, () => {
        t.check(
          turn.usage?.inputTokens,
          satisfies(
            "usage.inputTokens > 0",
            (value) => typeof value === "number" && value > 0,
          ),
        );
        t.check(
          turn.usage?.outputTokens,
          satisfies(
            "usage.outputTokens > 0",
            (value) => typeof value === "number" && value > 0,
          ),
        );
      });
    }
  },
});
