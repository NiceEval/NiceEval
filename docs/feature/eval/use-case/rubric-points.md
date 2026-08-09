# 计分制：检查点和质量分都用 Fact

通过制回答“是否满足要求”。需要表达“做到几成”时，使用 `defineScoreEval`，将每项证据显式消费为 score use。
分数从 0 累加，作者为每个 use 写出分值；没有 `.points()`、隐式满分或运行时严格模式。

## 检查点给分

```typescript
import { defineScoreEval } from "niceeval";
import { commandSucceeded, includes, isTrue, toolMatch } from "niceeval/expect";

export default defineScoreEval({
  judge: true,
  description: "安装并启动 DB-GPT",
  async test(t) {
    await t.send("把 DB-GPT 装起来，启动服务并确保健康检查通过。");

    const cloned = await t.sandbox.pathExists("db-gpt/README.md");
    await t.require(cloned, isTrue("db-gpt cloned"), { label: "已克隆仓库" });

    t.score("配置环境", t.sandbox.fileChanged("db-gpt/.env"), { max: 1 });
    t.score("安装依赖", t.calledTool(toolMatch("shell", { input: { command: /pip install/ } })), { max: 1 });
    t.score("启动服务", t.calledTool(toolMatch("shell", { input: { command: /dbgpt start/ } })), { max: 1 });

    const health = await t.sandbox.runCommand("curl", ["-s", "localhost:5670/health"]);
    t.score("健康检查可达", t.check(health, commandSucceeded()), { max: 1 });
    t.score("健康检查内容", t.check(health.stdout, includes("ok")), { max: 1 });
    return t.finishScore();
  },
});
```

每个 score use 独立计算。Boolean Fact 通过时获得 `max`，失败时获得 0；ScoreFact 按其 `[0,1]` 归一化分数乘以 `max`。`require` 是唯一的即时前置消费：失败时后续代码不继续执行，未创建的 score use 自然不会记分。

## 用 Judge 给连续分

Judge 与其他 ScoreFact 没有特殊计分分支：

```typescript
const notes = await t.sandbox.readText("NOTES.md");
const quality = t.judge.autoevals.closedQA("说明是否讲清动机和风险？", {
  input: "重构代码并说明动机与风险。",
  output: notes,
});

t.assert(quality, { atLeast: 0.7, label: "最低说明质量" });
t.score("说明质量", quality, { max: 20, key: "notes-quality" });
```

这一 Fact 既有一个 verdict use 又有一个 score use，但 evaluator 只运行一次。分数无效、不可用或 evaluator error 都保留为 Fact/use 结果；不会被截断为 0。

## 终态与聚合

`finishScore()` 封口后，所有 score use 可用时 Attempt 为 `scored`。失败的 verdict use 使它成为 `invalid` 且 `creditedScore` 为 0；不可用与 evaluator/执行错误保持 `null` credit，不能伪装为 0 分。

成功、已消费且没有 score use 的 ScoreFact 才能各计一次 `examScore`。有 score use 的 Fact 只贡献 `totalScore`，因此 Judge 与任意其他 ScoreFact 遵循完全相同的聚合规则。

## 相关阅读

- [计分 Fact](../../assertions/library/score-points.md) —— 终态和聚合规则。
- [Judge](../../judge/library.md) —— ScoreFact 材料与配置。
- [Verdict 与 Fact use](../../verdict/architecture.md) —— 失败与不可用的终态。
