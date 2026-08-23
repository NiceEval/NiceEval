# 用 Judge 检查多模态输出

先用普通 Assertion 检查文件存在，再把文件和上下文作为显式 Judge Material：

```ts
await t.sandbox.fileChanged("output/sales.png").orStop();

const image = t.material.customFile({
  name: "sales-chart",
  bytes: await t.sandbox.readBytes("output/sales.png"),
  mediaType: "image/png",
});

const check = judge.check({
  recipe: imageQualityRecipe,
  material: {
    brief: t.material.customText({ name: "brief", text: brief }),
    image,
  },
});

t.judge.llm(check).atLeast(0.8).label("图表可读");
```

文件变化由确定性 Assertion 负责；图片 bytes 则在读取时封口成 [custom file View](../../material/library.md#自定义与参考材料)。图片不存在、过大或 MIME 不匹配时，Judge Assertion 为 `unavailable`，不会显示为普通 mismatch 或 `0`。

读取面显示 measurement、rationale、引用和材料 digest。secret 与 credential 不写入 Record。
