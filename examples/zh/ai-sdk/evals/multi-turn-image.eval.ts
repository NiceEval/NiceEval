import { defineEval } from "fasteval";
import type { StreamEvent } from "fasteval";

// 把整段对话(user + assistant 消息)拼成一段文本,喂给 judge 当材料——
// t.judge 默认只看最后一轮(t.reply),这条问的是「整段三轮对话」,证据不够就得自己拼。
function conversationText(events: readonly StreamEvent[]): string {
  return events
    .filter((e): e is Extract<StreamEvent, { type: "message" }> => e.type === "message")
    .map((e) => `${e.role}: ${e.text}`)
    .join("\n");
}

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
      // 每轮 send 已各自 .expectOk();succeeded() 再确认整次运行没失败 / 没卡在 HITL。
      // (注:事件流现在也含 user 消息,所以不要再用 event("message",{count}) 数"轮数"。)
      t.succeeded();
    });

    await t.group("第一轮识别出图片内容", () => {
      t.messageIncludes(/蓝|blue|白|方块|square/i);
    });

    await t.group("后续追问能联系图片上下文", () => {
      // 第二轮问背景色，助手应答"蓝"；第三轮问形状颜色，应答"白"
      // 注意：t.messageIncludes 是 run 级断言，拼接整次运行所有 assistant 消息（不只最后一轮）。
      t.messageIncludes(/白|white/i);
    });

    t.judge.autoevals
      .closedQA("助手是否在三轮对话中始终基于第一轮发送的图片内容作答，而不是凭空发挥？", {
        on: conversationText(t.events),
      })
      .gate(0.7);
  },
});
