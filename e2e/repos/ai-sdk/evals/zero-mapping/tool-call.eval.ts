// Protocol behavior: 结果零映射 — fromAiSdk(result), called directly on a generateText
// result (no aiSdkAgent factory in between), maps step content and tool-call/result
// pairing into Turn events, and rolls the AI SDK usage shape up into an aggregated Usage.
import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";

export default defineEval({
  description: "fromAiSdk(result) maps tool-call pairing and aggregated usage straight from a generateText() result",
  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    turn.expectOk();

    t.calledTool("get_weather", { input: { city: /北京/ } });
    t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);

    t.check(t.usage.inputTokens, satisfies((v) => typeof v === "number" && v > 0, "usage.inputTokens > 0"));
    t.check(t.usage.outputTokens, satisfies((v) => typeof v === "number" && v > 0, "usage.outputTokens > 0"));
  },
});
