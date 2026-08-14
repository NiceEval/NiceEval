# Assertions —— Score Eval

Score Eval 用 `defineScoreEval` 表达同一次 Attempt 内“做到几成”的读数。`evaluationKind` 只取 `pass` 或 `score`；`points` 是 Assertion 的分值和 score 计算单位，绝不是另一种 Eval kind。

每个 Score Attempt 同时保存四态 raw [Verdict](../../verdict/architecture.md) claim 与独立的 `niceeval.score/v1` Attachment。Score Analysis 以 Score、显式 skip 和 execution facts 形成 scored、skipped 或 errored；通用摘要把 scored 映射为 passed。Score Eval 没有 gate，也不把 raw failed 纳入 Score 汇总。

## points 与贡献

Assertion 默认 record-only。`handle.score(points)` 让一条已登记 Assertion 按其 sealed evaluation 贡献分值；`points` 必须 finite 且非负。Boolean matched 贡献全部 points，mismatched 贡献 `0`；measurement `m` 贡献 `m × points`。

`t.score(points)` 也登记一个 Assertion entry，使用内建 direct-score criterion。它保存声明的 points 与 display，不绕开 Assertions Attachment。没有 score contribution 的正常 Score Eval 仍可形成 `earned: 0`。

Score 不声明 max、百分比或隐式每项 `+1`。同一评测的比较单位是相同的 score 规则，而不是一个虚构分母。

## 二态 Verdict

Score Eval 只比较 earned score，没有最低有效性门槛。Boolean mismatched 或 measurement 未达到 `atLeast` 只影响该项贡献，不改变 Verdict；正常封口即使 earned 为 `0` 也为 `passed`。

| 已封口事实 | Verdict | Score Attachment |
|---|---|---|
| 所有 score contribution 可算 | `passed` | `complete`，包括 earned `0`。 |
| execution error，或 required score source unavailable / errored | `errored` | 已有分数不会删除；状态是 partial 或 unavailable。 |

Score handle 不提供 `.gate()` 或 generic `.optional()`。`await handle.orStop()` 只作为控制流 barrier：condition 不满足时正常停止当前 continuation，保留此前已得分并形成 passed；未执行源码不生成 contribution。`t.skip(reason)` 形成 skipped 且不排名。纯 record-only Assertion 的 mismatch 不改变 Score Verdict。

## complete、partial 与 unavailable

`niceeval.score/v1` 用 `state` 描述分数的完整度：

| state | 条件 | `earned` |
|---|---|---|
| `complete` | 所有声明的 contribution 都有可计算的 sealed evaluation。 | 一个正式有限数值。 |
| `partial` | execution 或一个 required score source 使部分贡献不能确定，但至少一项贡献已可审计。 | 已知下界，不可当完整排名值。 |
| `unavailable` | 无法形成任何可审计的 earned 数值。 | 缺失，并保存具名原因。 |

非贡献 Assertion 的 unavailable 或 errored 不影响 Score Verdict。相反，缺少一个声明过 points 的 required source 绝不折成零。

Report 同时显示 Score Analysis status、earned score、score state 与 raw historical Verdict claim。`partial` 与 `unavailable` 不与 `0` 混写；只有 scored + complete 参与排名或数值选择，errored 的已知下界只用于诊断。

Score Definition / rubric identity 是跨结果自动比较的目标约束，但 `niceeval.score/v1` 尚未显式携带它。正式 identity 可用前，Report 保持已有选择行为，不承诺自动比较定义不明的 Score，也不读取 Runner 常量或整个 execution fingerprint 冒充 rubric identity。

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

若“测试通过”失败，该 entry 贡献 `0`，但其它已封口 entry 仍组成 earned score。若命令本身无法取得可信结果，Score Attachment 依上表保留 partial 或 unavailable。

## 相关阅读

- [Assertions](../README.md) —— persisted Assertion entry。
- [Verdict](../../verdict/architecture.md) —— 四态优先级。
- [Score Eval 用例](../../eval/use-case/rubric-points.md) —— 完整 authoring 场景。
- [Display](display.md) —— 稳定读取面。
