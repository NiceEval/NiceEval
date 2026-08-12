# Assertions —— Score Eval

Score Eval 用 `defineScoreEval` 表达同一次 Attempt 内“做到几成”的读数。`evaluationKind` 只取 `pass` 或 `score`；`points` 是 Assertion 的分值和 score 计算单位，绝不是另一种 Eval kind。

每个 Score Attempt 同时保存四态 [Verdict](../../verdict/architecture.md) 与独立的 `niceeval.score/v1` Attachment。Verdict 回答 Attempt 的 execution、gate 和 skip 终态；Score Attachment 回答已挣到多少分以及该数是否完整。两者不能互相推导。

## points 与贡献

Assertion 默认 record-only。`handle.score(points)` 让一条已登记 Assertion 按其 sealed evaluation 贡献分值；`points` 必须 finite 且非负。Boolean matched 贡献全部 points，mismatched 贡献 `0`；measurement `m` 贡献 `m × points`。

`t.score(points)` 也登记一个 Assertion entry，使用内建 direct-score criterion。它保存声明的 points 与 display，不绕开 Assertions Attachment。没有 score contribution 的正常 Score Eval 仍可形成 `earned: 0`。

Score 不声明 max、百分比或隐式每项 `+1`。同一评测的比较单位是相同的 score 规则，而不是一个虚构分母。

## gate 与四态 Verdict

Score Eval 的 entry 可以既有 points 又是 gate。points 决定 earned score；gate 决定其 result 是否参与 Verdict fold。这两个事实正交：

| 已封口事实 | Verdict | Score Attachment |
|---|---|---|
| gate failed，所有贡献可算 | `failed` | `complete`，保留全部 earned score。 |
| 没有 gate failed，所有贡献可算 | `passed`，除非更高优先级条件 | `complete`。 |
| 显式 skip，没有更高优先级条件 | `skipped` | 已封口贡献照实保存；未求值部分按 partial 或 unavailable 标示。 |
| execution error，或 required Assertion unavailable / errored | `errored` | 已有分数不会删除；状态是 partial 或 unavailable。 |

`.gate()` 只声明 Verdict 条件，不清空 points。`.orStop()` 只停止当前作者 continuation；此前已封口的 contribution 仍保留，未执行代码不补零。

## complete、partial 与 unavailable

`niceeval.score/v1` 用 `state` 描述分数的完整度：

| state | 条件 | `earned` |
|---|---|---|
| `complete` | 所有声明的 contribution 都有可计算的 sealed evaluation。gate failed 不影响此状态。 | 一个正式有限数值。 |
| `partial` | execution 或一个 required score source 使部分贡献不能确定，但至少一项贡献已可审计。 | 已知下界，不可当完整排名值。 |
| `unavailable` | 无法形成任何可审计的 earned 数值。 | 缺失，并保存具名原因。 |

非贡献 Assertion 的 unavailable 仍由 Verdict 规则处理；它不会把已经完整计算的 score 伪装成 partial。相反，缺少一个声明过 points 的 required source 绝不折成零。

Report 同时显示 Verdict、earned score 和 score state。`partial` 与 `unavailable` 不与 `0` 混写；gate-failed 的 complete score 也不能被显示成“没有分数”。

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
