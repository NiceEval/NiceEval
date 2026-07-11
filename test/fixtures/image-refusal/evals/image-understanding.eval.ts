import { defineEval } from "niceeval";

// 回归夹具:与 examples/zh/ai-sdk/evals/image-understanding.eval.ts 同款断言。
// 配 refusal-agent(永远回复"模型不支持图像输入"),验证「模型没看图」这种明确失败
// 一定会让 eval verdict = failed,而不是被过松的 gate 断言悄悄放过。
export default defineEval({
  description: "AI 助手：理解图片内容（拒绝识图回归夹具）",

  async test(t) {
    const turn = await t.sendFile("sample.png", "这张图片里有什么？主要是什么颜色？");
    turn.expectOk();

    await t.group("助手描述出图片内容", () => {
      t.succeeded();
      // 必须同时提到两个具体特征(蓝色背景 + 白色方块),而不是任一宽泛关键词就算数——
      // "图片"/"颜色"这类泛词连"我看不了图片"式的拒绝语都能命中,会把假阴性误判成通过。
      t.messageIncludes(/蓝|blue/i);
      t.messageIncludes(/白|方块|square/i);
    });

    t.judge.autoevals
      .closedQA("助手是否描述了这张图片的内容(蓝色背景、中间一个白色方块),而不是答非所问？")
      .gate(0.7);
  },
});
