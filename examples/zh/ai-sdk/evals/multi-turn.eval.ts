import { defineEval } from "fasteval";

// 评测：多轮对话。
//
// 同一个会话里连发多轮 t.send(自动续接 sessionId),作用域断言看的是【整段会话累计】的事件流:
// 跨多轮一共发了几条回复、中间那轮有没有调对工具。考的是助手能正常多轮收发、且按需调用工具。
export default defineEval({
  description: "AI 助手：多轮对话",

  async test(t) {
    (await t.send("你好，你能做什么？")).expectOk();
    (await t.send("北京今天天气怎么样？")).expectOk();
    (await t.send("谢谢，就这些")).expectOk();

    await t.group("三轮都正常收发", () => {
      t.succeeded();
      t.event("message", { count: 3 }); // 三轮 → 三条 assistant 回复
    });

    await t.group("中间那轮按需调了 get_weather", () => {
      t.calledTool("get_weather", { input: { city: "北京" } });
    });

    t.judge.agent("助手在这段多轮对话里是否自始至终切题、有礼貌、前后连贯？").atLeast(0.7);
  },
});
