import { defineEval } from "fasteval";

// 评测：图片理解。
//
// 用 t.sendFile 把本地真实图片(evals/fixtures/sample.png,蓝底中间一个白方块)发给助手:
// fasteval 读文件 → base64 → 经 adapter 交给 app → AI 模式喂多模态视觉模型 / mock 模式给固定描述。
// 助手应描述出图片内容(主色调蓝、有个白方块)。
export default defineEval({
  description: "AI 助手：理解图片内容",

  async test(t) {
    const turn = await t.sendFile("evals/fixtures/sample.png", "这张图片里有什么？主要是什么颜色？");
    turn.expectOk();

    await t.group("助手描述出图片内容", () => {
      t.succeeded();
      t.messageIncludes(/蓝|blue|白|方块|图片|颜色/i);
    });

    t.judge.agent("助手是否描述了这张图片的内容(蓝色背景、中间一个白色方块),而不是答非所问？").atLeast(0.7);
  },
});
