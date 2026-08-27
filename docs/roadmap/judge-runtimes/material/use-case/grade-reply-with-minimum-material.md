# 用最小材料评估回复

只判断回复自身时，不必把 task、Action 或 result 一起交给 Judge：

```ts
const check = judge.check({
  recipe: writingQuality,
  material: { reply: turn.material.reply },
});

t.judge.llm(check).atLeast(0.8).label("表达质量");
```

判断是否完成任务时，recipe 明确要求 task 与 reply 两个 slot：

```ts
const check = judge.check({
  recipe: instructionFollowing,
  material: {
    task: turn.material.input,
    reply: turn.material.reply,
  },
});

t.judge.llm(check).atLeast(0.8).label("任务完成度");
```

两条 Check 都不会自动追加本 Turn 的 Action、result、其它 Turn 或 trace。

内建 factuality、summarizes 一类 recipe 的 expected answer 或 source text 也必须是显式 reference slot。Replayable Grading 中这样绑定短文本参考：

```ts
const definition = defineGrading({
  version: "support-answer/v2",
  evaluationKind: "pass",
  async grade(g) {
    const turn = g.turn("answer");
    const expected = g.material.referenceText({
      name: "expected-answer",
      text: "退款期限是收货后 30 天。",
    });

    const check = judge.check({
      recipe: factualAnswer,
      material: {
        reply: turn.material.reply,
        expected,
      },
    });

    g.judge.llm(check).atLeast(0.9);
  },
});
```

`expected` 作为 untrusted definition reference 进入 material manifest，不藏在 rubric 或系统提示里。只改 threshold 可以复用同一次 Judge Evaluation；改变 expected text 会产生新的 Evaluation。
