# Assertions —— Score Eval

Score Eval 用 `defineScoreEval` 表达同一次 Attempt 内“做到几成”的读数。`evaluationKind` 只取 `pass` 或 `score`；`points` 是 Assertion 的分值和 score 计算单位，绝不是另一种 Eval kind 或 durable family。

每个 Score Attempt 的 [Verdict](../../verdict/architecture.md) 都由 Core outcome、sealed Assertions 与显式 skip 在读侧折叠。earned score、其 `complete`／`partial`／`unavailable` 完整度，以及 rubric 下的可比较性同样从 sealed Assertions 读侧形成；它们不另存一份分数文档。

## points 与贡献

Assertion 默认 record-only。`handle.score(points)` 让一条已登记 Assertion 按其 sealed evaluation 贡献分值；`points` 必须 finite 且非负。Boolean matched 贡献全部 points，mismatched 贡献 `0`；measurement `m` 贡献 `m × points`。

`t.score(points)` 也登记一个 Assertion entry，使用内建 direct-score criterion。它保存声明的 points 与 display，不绕开 Assertions payload。没有 score contribution 的正常 Score Eval 仍可形成 `earned: 0`。

Score 不声明 max、百分比或隐式每项 `+1`。同一评测的比较单位是同一份 rubric：它规定哪些 Assertions 贡献、各自 points 与读侧汇总语义，而不是由页面、Runner 常量或一个虚构分母猜出。

## Verdict 与 Score Eval

Score Eval 没有最低有效性 gate。Boolean mismatched 或 measurement 未达到 `atLeast` 只影响该项贡献，不改变 Verdict；正常封口即使 earned 为 `0` 也为 `passed`。

| 已封口事实 | Verdict | score 读侧结果 |
|---|---|---|
| 所有 rubric 所需 contribution 都可算 | `passed` | `complete`，包括 earned `0`。 |
| execution error，或 required score source unavailable / errored | `errored` | 已有分数不会删除；结果是 `partial` 或 `unavailable`。 |
| 显式 skip，且没有更高优先级条件 | `skipped` | 保留已封口 contribution，但不把该 Attempt 排名。 |

Score handle 不提供 `.gate()` 或 generic `.optional()`。`await handle.orStop()` 只作为控制流 barrier：condition 不满足时正常停止当前 continuation，保留此前已得分；未执行源码不生成 contribution。纯 record-only Assertion 的 mismatch 不改变 Score Verdict。

## complete、partial 与 unavailable

Score 完整度是对同一 rubric 下 sealed contribution 的读侧判断：

| state | 条件 | `earned` |
|---|---|---|
| `complete` | 所有声明的 contribution 都有可计算的 sealed evaluation。 | 一个正式 finite 数值。 |
| `partial` | execution 或一个 required score source 使部分 contribution 不能确定，但至少一项 contribution 已可审计。 | 已知下界，不可当完整排名值。 |
| `unavailable` | 无法形成任何可审计的 earned 数值。 | 缺失，并保留具名原因。 |

非贡献 Assertion 的 unavailable 或 errored 不影响 Score Verdict。相反，缺少一个声明过 points 的 required source 绝不折成零。`partial` 与 `unavailable` 不与 `0` 混写；只有同一 rubric 下的 `complete` 结果可进入数值比较，已知下界只用于诊断。`complete` 的 earned 为 `0` 是正式数值，不能因 falsy 检查而隐藏。

固定 [Inspection Operations](../../reports/architecture.md) 以闭合 result 呈现 Score、完整度、Verdict 与相关 Evidence。Delivery 不重新读取当前源码或重跑 matcher。

## 作者写法

```ts
export default defineScoreEval({
  async test(t) {
    await t.send("把 DB-GPT 装起来并通过健康检查。");

    t.sandbox.fileChanged("db-gpt/.env")
      .score(1)
      .label("配置运行环境");

    const tests = await t.sandbox.runCommand("pnpm", ["test"]);
    t.check(tests, commandSucceeded())
      .score(2)
      .label("测试通过");

    t.score(1).label("代码精简");
  },
});
```

若“测试通过”失败，该 entry 贡献 `0`，但其它已封口 entry 仍组成 earned score。若命令本身无法取得可信结果，读侧依上表保留 `partial` 或 `unavailable`，而不是抹去已有 contribution。

## 相关阅读

- [Assertions](../README.md) —— persisted Assertion entry。
- [Verdict architecture](../../verdict/architecture.md) —— 四态优先级。
- [Inspection Architecture](../../reports/architecture.md) —— 闭合 Score 结果与比较边界。
- [Score Eval 用例](../../eval/use-case/rubric-points.md) —— 完整 authoring 场景。
- [Display](display.md) —— 稳定读取面。
