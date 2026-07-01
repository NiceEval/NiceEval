import { defineEval } from "fasteval";
import { includes } from "fasteval/expect";

// 评测：多轮对话。
//
// 同一个会话里连发多轮 t.send(自动续接 sessionId),作用域断言看的是【整段会话累计】的事件流:
// 跨多轮一共发了几条回复、中间那轮有没有调对工具。考的是助手能正常多轮收发、且按需调用工具。
export default defineEval({
  description: "AI 助手：多轮对话",

  async test(t) {
    await t.send("1+1=?")
    t.succeeded();
    t.check(t.reply,includes("2"));

    const second = await t.send("北京今天天气怎么样？")
    t.calledTool("get_weather", { input: { city: "北京" } });
    second.messageIncludes("北京");

    t.judge.autoevals.closedQA("有回答对算数是，并且回答了北京天气的问题").gate(0.8);
  },
});
