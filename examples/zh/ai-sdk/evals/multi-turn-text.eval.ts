import { defineEval } from "niceeval";

// 这条 eval 验证 agent 在不调用工具的纯文本会话里能记住上文。
//
// 三轮都不问天气、搜索或计算，避免触发工具；第二轮要求它回忆第一轮自己使用的语言。
export default defineEval({
  description: "测试 agent 在多轮纯文本对话中维持上下文连贯的能力",

  async test(t) {
    await (await t.send("请用一句话介绍一下自己")).succeeded().stopOnFailure();
    await (await t.send("你刚才说的是什么语言？")).succeeded().stopOnFailure();
    await (await t.send("好的，谢谢你的回答")).succeeded().stopOnFailure();

    await t.group("三轮都正常收发", () => {
      // 每轮 send 已各自 succeeded().stopOnFailure()；succeeded() 再确认整次运行没有失败或卡在 HITL。
      // 事件流现在也含 user 消息，不再用 event("message",{count}) 数 assistant 轮数。
      t.succeeded();
    });

    await t.group("第二轮能回忆起第一轮内容", () => {
      // 第二轮应提到“中文”或“汉语”等，说明它不是把第二个问题当成孤立输入处理。
      t.messageIncludes(/中文|汉语|Chinese/i);
    });
  },
});
