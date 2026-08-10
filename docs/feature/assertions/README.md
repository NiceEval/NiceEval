# Assertions

NiceEval 的检查由 Fact 和 use 组成。scope、Sandbox 与 Judge 创建可求值的证据 Fact；`check`、`require` 和 `score` 明确说明 Fact 怎样影响 Attempt。值或 EvidenceSource 加 Match 的调用会原子地创建 Fact 并登记 use。

Judge、值 matcher、作用域检查和 Sandbox 检查都使用同一张 Fact/use 图。Judge 只是产生 `ScoreFact` 的一个 producer，不拥有专用 Assertion 持久化字段或展示分支。

```ts
const turn = await t.send("修复测试失败。");
const answered = turn.succeeded();
const quality = turn.judge.autoevals.closedQA("回答是否解释了修复？");

t.check(answered);
t.check(quality.atLeast(0.8));
```

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 创建和消费 Fact | [Library](library.md) |
| 图、状态与 schema 18 持久化形状 | [Architecture](architecture.md) |
| 证据完整性与 unavailable | [Evidence](architecture/evidence.md) |
| show、view、source 与反馈怎样显示 Fact/use | [Display](library/display.md) |
| `defineScoreEval` 中的计分 | [Score](library/score-points.md) |
| Judge 的 capability、材料和模型边界 | [Judge](../judge/README.md) |

普通 Fact 没有 `.gate()`、`.soft()`、`.optional()`、`.observe()`、`.points()` 或 `.stopOnFailure()`。`ScoreFact.atLeast(n)` 是纯 threshold view，不登记 use；判定仍由 `t.check` 或 `t.require` 登记。作者面也没有 `t.assert`、`t.assertIfCovered` 或 `t.fact` 的兼容入口。
