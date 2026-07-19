// Eval 闭环第 2 行(docs/engineering/e2e-ci/adapters/openai-compat.md):
// Responses 的 function_call → action.called,output_text → message,usage 到位。

import { defineEval } from "niceeval";
import { isDefined, satisfies } from "niceeval/expect";

export default defineEval({
  description: "Responses 响应经 fromResponses 零映射:function_call/output_text/usage",

  async test(t) {
    const turn = await t.send(
      "What's the weather in Brooklyn right now? You must call the get_weather tool to check — do not answer from memory.",
    );
    turn.expectOk();

    await t.group("function_call 变成 action.called", () => {
      turn.calledTool("get_weather", { input: { city: "Brooklyn" } });
    });

    await t.group("usage 到位", () => {
      t.check(turn.usage, isDefined("Responses 响应带 usage"));
      t.check(
        turn.usage?.inputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "inputTokens 为正数"),
      );
      t.check(
        turn.usage?.outputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "outputTokens 为正数"),
      );
    });
  },
});
