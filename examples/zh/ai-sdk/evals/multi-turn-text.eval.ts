import { defineEval } from "fasteval";

// 评测：多轮纯文本对话（不涉及工具调用）。
//
// 三轮都是纯文本问答，考的是助手能否维持上下文连贯、对前轮内容有记忆。
// 故意不问天气之类会触发工具的问题，确保走的是纯文本路径。
export default defineEval({
  description: "AI 助手：多轮纯文本对话",

  async test(t) {
    (await t.send("请用一句话介绍一下自己")).expectOk();
    (await t.send("你刚才说的是什么语言？")).expectOk();
    (await t.send("好的，谢谢你的回答")).expectOk();

    await t.group("三轮都正常收发", () => {
      t.succeeded();
      t.event("message", { count: 3 });
    });

    await t.group("第二轮能回忆起第一轮内容", () => {
      // 助手第二轮应提到"中文"或"汉语"等——说明它记住了上文
      t.messageIncludes(/中文|汉语|Chinese/i);
    });

    t.judge.agent("助手在三轮对话中是否保持了上下文连贯，第二轮能够联系第一轮的回答？").atLeast(0.7);
  },
});
