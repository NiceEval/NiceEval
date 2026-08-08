# 用 Experiment 做裁判 A/B

## 解决什么问题

你想确认评分判定是否依赖某个裁判模型，同时保持题目、rubric、阈值、被测 Agent 与样本完全相同。临时 CLI flag 无法复现，复制 Eval 又会让评分规则分叉；正确的变化轴是两个 Experiment 的 `judge` 配置。

## 全流程

Eval 只写一次 rubric 与材料：

```ts
export default defineEval({
  judge: { timeoutMs: 180_000 },
  async test(t) {
    const turn = await t.send("解释这次修改的风险。");
    turn.judge.autoevals
      .closedQA("说明是否覆盖兼容性、回滚与数据风险？")
      .atLeast(0.75);
  },
});
```

两个 Experiment 只改变裁判执行配置：

```ts
// experiments/judge-ab/mini.ts
export default defineExperiment({
  agent: codexAgent(),
  evals: ["explanations/"],
  judge: { model: "gpt-5.4-mini" },
  labels: { judge: "mini" },
});

// experiments/judge-ab/full.ts
export default defineExperiment({
  agent: codexAgent(),
  evals: ["explanations/"],
  judge: { model: "gpt-5.4" },
  labels: { judge: "full" },
});
```

两份 Experiment 各自进入配置身份与 Run 条目，报告按 `labels.judge` 对比。`judge` 决定实际调用哪个模型，`labels` 只给报告命名；两者不能互换。

## 边界

- Experiment 不得改 rubric、评分材料、severity 或 threshold；这些是 Eval 对“怎么算对”的定义。
- 单条断言 `{ model }` 优先级更高，适合少数必须用特定裁判的 rubric；它会让该条断言不参与 Experiment 的 model A/B，应有意使用。
- Judge 没有 CLI model flag。临时 override 会制造无法从 Experiment 文件重建的比较条件。
- `apiKeyEnv` 只是凭据变量名；变量值不落盘、不进指纹。

## 相关阅读

- [Judge Library](../library.md#模型与鉴权) —— 完整求值链与凭据边界。
- [Experiments](../../experiments/README.md#defineexperiment-的形状) —— `judge` 为什么属于可签入运行配置。
