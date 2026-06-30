import { defineEval } from "fasteval";

// 评测：先发图片，后续两轮纯文字追问。
//
// 第一轮：图片（蓝底白方块）+ 文字问题，考图片理解。
// 第二、三轮：纯文字追问，考助手是否记住了第一轮的图片内容（跨轮图片上下文）。
// 图片文件与本 eval 同目录：evals/sample.png。
export default defineEval({
  description: "AI 助手：图片 + 后续多轮文字追问",

  async test(t) {
    (await t.sendFile("evals/sample.png", "这张图片里有什么？")).expectOk();
    (await t.send("图片里的背景是什么颜色？")).expectOk();
    (await t.send("中间那个形状是什么颜色的？")).expectOk();

    await t.group("三轮都正常收发", () => {
      t.succeeded();
      t.event("message", { count: 3 });
    });

    await t.group("第一轮识别出图片内容", () => {
      t.messageIncludes(/蓝|blue|白|方块|square/i);
    });

    await t.group("后续追问能联系图片上下文", () => {
      // 第二轮问背景色，助手应答"蓝"；第三轮问形状颜色，应答"白"
      // t.messageIncludes 看的是会话中最后一条 assistant 消息
      t.messageIncludes(/白|white/i);
    });

    t.judge
      .agent("助手是否在三轮对话中始终基于第一轮发送的图片内容作答，而不是凭空发挥？")
      .atLeast(0.7);
  },
});
