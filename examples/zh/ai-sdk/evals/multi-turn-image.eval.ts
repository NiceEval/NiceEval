import { defineEval } from "niceeval";
import type { StreamEvent } from "niceeval";

// 把整段对话(user + assistant 消息)拼成一段文本，喂给 judge 当材料。
// t.judge 默认只看最后一轮 t.reply；这里要评估三轮对话是否都围绕第一张图片，所以要显式传材料。
function conversationText(events: readonly StreamEvent[]): string {
  return events
    .filter((e): e is Extract<StreamEvent, { type: "message" }> => e.type === "message")
    .map((e) => `${e.role}: ${e.text}`)
    .join("\n");
}

// 这条 eval 验证 agent 能在多轮对话里保留第一轮图片上下文。
//
// 第一轮发送蓝底白方块图片并询问内容；第二、三轮只用文字追问背景和形状颜色。
// 如果后两轮还能答出蓝色背景、白色方块，就说明图片内容进入了会话上下文。
export default defineEval({
  judge: true,
  description: "测试 agent 在多轮对话中基于图片内容作答的能力",

  async test(t) {
    await (await t.sendFile("evals/sample.png", "这张图片里有什么？")).succeeded().orStop();
    await (await t.send("图片里的背景是什么颜色？")).succeeded().orStop();
    await (await t.send("中间那个形状是什么颜色的？")).succeeded().orStop();

    await t.group("三轮都正常收发", () => {
      // 每轮 send 已各自 succeeded().orStop()；succeeded() 再确认整次运行没有失败或卡在 HITL。
      // 事件流现在也含 user 消息，不再用 event("message",{count}) 数 assistant 轮数。
      t.succeeded();
    });

    await t.group("第一轮识别出图片内容", () => {
      t.messageIncludes(/蓝|blue|白|方块|square/i);
    });

    await t.group("后续追问能联系图片上下文", () => {
      // 第二轮问背景色，第三轮问形状颜色；run 级断言会拼接整次运行的 assistant 消息。
      t.messageIncludes(/白|white/i);
    });

    t.judge.autoevals
      .closedQA("助手是否在三轮对话中始终基于第一轮发送的图片内容作答，而不是凭空发挥？", {
        input: "用户先询问一张蓝底白色方块图片，再追问背景和中间形状的颜色。",
        output: conversationText(t.events),
      })
      .gate(0.7);
  },
});
