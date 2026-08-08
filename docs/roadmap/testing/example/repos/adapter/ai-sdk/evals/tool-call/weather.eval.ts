import { defineEval } from "niceeval";

// 协议行为：UI Message Stream 工具调用——天气 prompt 经 SSE 后端以**不带命名空间**
// 中不带命名空间的工具名调用 get_weather，调用与结果按 call id 配对；calculate 是反例。
export default defineEval({
  description: "天气 prompt 以不带命名空间的工具名调用 get_weather（SSE，按 call id 配对 output-available）",
  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    await turn.succeeded().stopOnFailure();

    await t.group("工具名调用 + 结果配对", () => {
      t.calledTool("get_weather", { input: { city: /北京/ } });
      t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
    });
    t.notCalledTool("calculate");
  },
});
