# 拆分或显式合批维度

两个维度需要不同材料时，建立两个 Check。不要把所有材料合并后让一个 Judge 自行忽略：

```ts
const shown = turn.material.actionResults(
  actionResultSelector.command({
    logicalExecutable: "niceeval",
    argsStart: ["show"],
    exactly: 1,
  }),
);

const responsibility = judge.check({
  recipe: replyOwnsReasoning,
  material: { reply: turn.material.reply },
});

const publishedResult = judge.check({
  recipe: resultIsPublic,
  material: { shown },
});

t.judge.llm(responsibility).atLeast(0.8);
t.judge.llm(publishedResult).atLeast(0.9);
```

前一条 Judge 看不到 Tool result，后一条也看不到 reply。两次独立请求保留各自的 visible manifest 与 Decision。

只有 recipe 声明 `batchSafe: true`，并且所有 Check 的 canonical visibility manifest、安全配置、workspace capability、runtime profile 与 presentation protocol 完全相同时，作者才能显式合批：

```ts
const sharedMaterial = {
  task: turn.material.input,
  reply: turn.material.reply,
} as const;

const [accuracy, clarity] = t.judge.llm.batch([
  judge.check({ recipe: answerAccuracy, material: sharedMaterial }),
  judge.check({ recipe: answerClarity, material: sharedMaterial }),
]);

accuracy.atLeast(0.9);
clarity.atLeast(0.8);
```

Runtime 不会因队列拥塞自动合批。集合中 source ref、顺序、重复次数、digest、coverage、redaction、预算或 capability 任一不同，都拒绝 batch，作者必须拆调用。

Batch 只证明没有扩张可见性，不承诺多个 Decision 在统计上独立。Transport failure 可以使整批 unavailable；单项响应解码错误只使对应 Assertion errored。Batch composition 与 protocol version 进入每个 Judge Evaluation 的复用身份。
