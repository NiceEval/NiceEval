# 用 Judge 检查多模态输出

先用普通 Assertion 检查文件存在，再把文件和上下文作为显式 Judge Material：

```ts
await t.sandbox.fileChanged("output/sales.png").orStop();

t.judge.llm({
  recipe: imageQualityRecipe,
  material: { image: t.sandbox.file("output/sales.png"), brief },
}).atLeast(0.8).label("图表可读");
```

图片不存在、过大或 MIME 不匹配时，Judge Assertion 为 `unavailable`。Pass 或 Score 的投影按参与方式解释它，不会显示为普通 mismatch 或 `0`。

读取面显示 measurement、rationale、引用和材料 digest。secret 与 credential 不写入 Record。
