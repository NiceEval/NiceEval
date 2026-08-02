import { defineEval } from "niceeval";

// 这条 eval 验证 agent 能读取用户随消息上传的图片，而不是只看文字问题。
//
// t.sendFile 会把本地真实图片(evals/fixtures/sample.png,蓝底中间一个白方块)编码成 base64，
// 经 adapter 转给被测 app；AI 模式交给多模态模型，mock 模式返回固定描述。
// 断言只看图片里的具体特征，避免“我看不到图片”这类泛泛回复误通过。
export default defineEval({
  description: "测试 agent 在图片理解上的能力",

  async test(t) {
    const turn = await t.sendFile("evals/fixtures/sample.png", "这张图片里有什么？主要是什么颜色？");
    await turn.succeeded().stopOnFailure();

    await t.group("助手描述出图片内容", () => {
      t.succeeded();
      // 必须同时提到两个具体特征(蓝色背景 + 白色方块)，而不是任一宽泛关键词就算数。
      t.messageIncludes(/蓝|blue/i);
      t.messageIncludes(/白|方块|square/i);
    });

    t.judge.autoevals
      .closedQA("助手是否描述了这张图片的内容(蓝色背景、中间一个白色方块),而不是答非所问？")
      .gate(0.7);
  },
});
