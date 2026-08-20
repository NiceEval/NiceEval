# 具名 Experiment 族

## 用户需要

一组 Experiment 往往只有 Agent、model 或 reasoning effort 不同。
每个配置继续需要稳定 ID、独立生命周期与独立报告坐标，但作者不必复制十几个几乎相同的文件。

```ts
const common = {
  evals: ["memory/"],
  attempts: 5,
} as const;

export default defineExperiments({
  "codex-gpt-5.6-high": {
    ...common,
    agent: codexAgent(),
    model: "gpt-5.6",
    reasoningEffort: "high",
  },
  "claude-opus-4.1": {
    ...common,
    agent: claudeCodeAgent(),
    model: "claude-opus-4.1",
  },
});
```

若文件是 `experiments/compare.ts`，两个 Experiment ID 分别是：

```text
compare/codex-gpt-5.6-high
compare/claude-opus-4.1
```

## 核心取舍

这个 API 是 keyed record fan-out，不是匿名笛卡尔积。
每个 key 都是 review 中可见、可在 CLI 精确选择、可持久化的身份段。

现有“一文件一配置”仍是最短默认路径。
只有一组配置共享大量静态字段时，才使用 `defineExperiments()`。

## 每个成员仍是完整 Experiment

每个成员独立拥有：

- Agent、model、flags、labels 与 attempts；
- Sandbox layer、setup、teardown 与共享状态声明；
- Run、Sample、预算、并发、fingerprint 与结果沿用；
- `niceeval exp list`、prefix selector 与报告坐标。

文件只减少作者重复，不建立“族级 Run”或“族级 lifecycle”。

## 研究取舍

[Ori Eval](../../../research/assertion-api-dx/ori-eval.md) 用 `candidateModels` 与 Bun `test.each()` 快速生成 model matrix，证明了共享测试体的作者价值。
NiceEval 不采用数组位置或运行时 model catalog 当 Experiment identity，而是要求每个成员有可 review 的 key。

这个形状也沿用 NiceEval 已有的 [Eval keyed-record fan-out](../../../feature/eval/library.md#测试集从输入数组生成多条-eval) 经验。
差别在于 Experiment 成员各自拥有 Run 与 lifecycle，不共享一个数据集执行体。

## 不做什么

- 不接受 `model: string[]` 或 `agent: Agent[]`。
- 不自动生成 key，也不把数组下标保存成身份。
- 不提供通用 Cartesian product builder。
- 不让 CLI 临时覆写 model 后假装是可签入 Experiment。
- 不让一个成员的 setup 只运行一次后隐式共享给全部成员。

## 入口

- [Library](library.md) —— `defineExperiments()` 的公开形状与 ID 规则。
- [Architecture](architecture.md) —— discovery、生命周期、错误与 source identity。
