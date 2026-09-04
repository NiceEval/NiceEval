import { defineEval, defineJudge, judge } from "niceeval";
import { pattern } from "niceeval/expect";

const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: { criterion: judge.referenceText({ name: "criterion", text: "回复是否根据先前图片正确说明中间形状的颜色，而不是凭空发挥？" }) },
});

// 这条 eval 验证 agent 能在多轮对话里保留第一轮图片上下文。
//
// 第一轮发送蓝底白方块图片并询问内容；第二、三轮只用文字追问背景和形状颜色。
// 如果后两轮还能答出蓝色背景、白色方块，就说明图片内容进入了会话上下文。
export default defineEval({
  judge: judging,
  description: "测试 agent 在多轮对话中基于图片内容作答的能力",

  async test(t) {
    const image = await t.sendFile("evals/sample.png", "这张图片里有什么？");
    await image.succeeded().orStop();
    const background = await t.send("图片里的背景是什么颜色？");
    await background.succeeded().orStop();
    const shape = await t.send("中间那个形状是什么颜色的？");
    await shape.succeeded().orStop();

    await t.group("三轮都正常收发", () => {
      // 每轮 send 已各自 succeeded().orStop()；succeeded() 再确认整次运行没有失败或卡在 HITL。
      // 事件流现在也含 user 消息；这里直接确认每轮 send 的最终状态。
      t.succeeded();
    });

    await t.group("第一轮识别出图片内容", () => {
      t.check(image.message, pattern(/蓝|blue|白|方块|square/i));
    });

    await t.group("后续追问能联系图片上下文", () => {
      // 第二轮问背景色，第三轮问形状颜色；这里明确只组合两次追问的回复。
      t.check([background.message, shape.message].join("\n"), pattern(/白|white/i));
    });

    shape
      .check(judge.check({
        recipe: judging.recipes[0],
        material: { task: shape.material.input, reply: shape.material.reply, criterion: judging.material.criterion },
      }), judge.llm().atLeast(0.7))
      .gate();
  },
});
