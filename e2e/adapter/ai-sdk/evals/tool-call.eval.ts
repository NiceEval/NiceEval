// Protocol behavior: UI Message Stream 工具调用 — a weather prompt over the SSE
// `useChat` backend calls get_weather by its bare tool name (not an MCP-style
// namespaced name), paired with its result by call id; calculate is untouched (反例).
import { defineEval } from "niceeval";
import { eventMatch, pattern, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "天气 prompt 以裸工具名调用 get_weather(SSE,按 call id 配对 output-available)",
  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    await t.require(turn.succeeded());

    await t.group("裸工具名调用 + 结果配对", () => {
      t.check(
        t.calledTool(
          toolMatch("get_weather", {
            input: satisfies(
              '"get_weather" input',
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                (typeof input["city"] === "string"
                  ? /北京/.test(input["city"])
                  : /北京/.test(JSON.stringify(input) ?? "")),
            ),
          }),
        ),
      );
      t.check(
        t.event(
          eventMatch("message", {
            role: "assistant",
            text: pattern(/°C|气温|天气|晴|多云|雨|阴/),
          }),
        ),
      );
    });
    t.check(t.notCalledTool(toolMatch("calculate")));
  },
});
