// Protocol behavior: UI Message Stream 工具调用 — a weather prompt over the SSE
// `useChat` backend calls get_weather by its bare tool name (not an MCP-style
// namespaced name), paired with its result by call id; calculate is untouched (反例).
import { defineEval } from "niceeval";

export default defineEval({
  description: "weather prompt calls get_weather by its bare tool name (SSE, output-available paired by call id)",
  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    turn.expectOk();

    await t.group("bare tool name call + result pairing", () => {
      t.calledTool("get_weather", { input: { city: /北京/ } });
      t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
    });
    t.notCalledTool("calculate");
  },
});
