// Protocol behavior: UI Message Stream 工具调用 — a weather prompt over the SSE
// `useChat` backend calls get_weather by its bare tool name (not an MCP-style
// namespaced name), paired with its result by call id.
import { defineEval } from "niceeval";
import { jsonMatch, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "天气 prompt 以裸工具名调用 get_weather(SSE,按 call id 配对 output-available)",
  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    await turn.succeeded().orStop();

    await t.group("裸工具名调用 + 结果配对", () => {
      t.calledTool(
        toolMatch("get_weather", {
          input: jsonMatch({ city: /北京/ }),
        }),
      );
      t.check(
        t.events,
        satisfies<typeof t.events>(
          "assistant 回复提及天气",
          (events) =>
            events.some(
              (event) =>
                event.type === "message" &&
                event.role === "assistant" &&
                /°C|气温|天气|晴|多云|雨|阴/.test(event.text),
            ),
        ),
      );
    });
  },
});
