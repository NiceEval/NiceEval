# 计分制：检查点和质量分

通过制回答“是否满足要求”。需要表达“做到几成”时，使用 `defineScoreEval`，用 `.score(n)` 让已登记
Assertion 贡献分数。分数从 0 累加，作者为每个计分项写出分值；没有隐式满分或运行时
严格模式。

## 检查点给分

```typescript
import { defineScoreEval } from "niceeval";
import { commandSucceeded, includes } from "niceeval/expect";

export default defineScoreEval({
  description: "安装并启动 DB-GPT",
  async test(t) {
    await t.send("把 DB-GPT 装起来，启动服务并确保健康检查通过。");

    t.sandbox.pathExists("db-gpt/README.md")
      .score(1)
      .label("已克隆仓库");

    t.calledTool("shell", { input: { command: /pip install/ } })
      .score(1)
      .label("安装依赖");
    t.calledTool("shell", { input: { command: /dbgpt start/ } })
      .score(1)
      .label("启动服务");

    const health = await t.sandbox.runCommand("curl", ["-s", "localhost:5670/health"]);
    t.check(health, commandSucceeded()).score(1).label("健康检查可达");
    t.check(health.stdout, includes("ok")).score(1).label("健康检查内容");
  },
});
```

每条 Assertion 默认只保存 evaluation、evidence 和 diagnostic。`.score(n)` 使 Boolean matched 贡献
`n`，mismatched 贡献 `0`；measurement `m` 贡献 `m * n`。

## 用 Judge 给连续分

Judge 与其它 measurement Assertion 没有特殊计分分支：

```typescript
const notes = await t.sandbox.readText("NOTES.md");
t.judge.autoevals.closedQA("说明是否讲清动机和风险？", {
  input: "重构代码并说明动机与风险。",
  output: notes,
}).score(20).key("notes-quality").label("说明质量");
```

measurement 为 `.8` 且 `.score(20)` 时贡献 `+16`。同一个 Judge evaluator 只运行一次，写一条
AssertionResult。分数无效、不可用或 evaluator error 都保留为 `unavailable` / `errored` 结果；
只有配置 score 的 Assertion 才使 grading 不可排名。

## 终态

`test` 正常返回后，Runner 自动封口。所有 Assertion 可用时 Attempt 为 `scored`；没有计分项时也是
`scored`，正式 score 为 `0`。measurement 无需 threshold 就能封口；`.atLeast(n)` 只增加局部
`met` / `below` condition，不改变 contribution。

## 相关阅读

- [Score Eval](../../assertions/library/score-points.md) —— contribution 与可排名性。
- [Judge](../../judge/library.md) —— Judge evaluator 与配置。
- [Verdict 与 AssertionResult](../../verdict/architecture.md) —— Score Eval 不进入 Pass fold。
