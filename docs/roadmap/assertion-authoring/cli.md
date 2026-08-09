# Assertion 作者面 —— CLI

Fact 的判定语义只由 Library 的显式用途声明；隔离的 legacy Judge 继续读取现有句柄链。
`niceeval exp` 在本地、CI 与重跑时读取同一组 `assert`、`require` 与 `score` 用途，不提供运行期提级开关。

## `--strict`

目标 CLI 不接受 `--strict`：

```sh
niceeval exp local --strict
```

```text
Unknown option: --strict
Express required facts with t.assert(...) or await t.require(...) in the Eval source.
```

这是用法错误，不启动 Run，也不创建或修改 Record。
Experiment config、Run identity、configHash 与 fingerprint 都没有 strict 字段。

## Attempt 终态映射

每条 Attempt 明细与 JUnit testcase 使用同一张穷尽映射，不能各自把零分、无效分数或证据不足解释成另一种状态：

| Eval | 终态 | `niceeval exp` | JUnit | 结果携带 | 首过即停 |
|---|---|---|---|---|---|
| `defineEval` | `passed` | success | success | 是 | 命中 |
| `defineEval` | `failed` | failure | failure | 是 | 不命中 |
| `defineEval` | `errored` | error | error | 否 | 不命中 |
| `defineEval` | `skipped` | skipped | skipped | 否 | 不命中 |
| `defineScoreEval` | `scored` | success | success | 是 | 命中 |
| `defineScoreEval` | `invalid` | failure | failure | 无 issue 时 | 不命中 |
| `defineScoreEval` | `unavailable` | error | error | 否 | 不命中 |
| `defineScoreEval` | `errored` | error | error | 否 | 不命中 |
| `defineScoreEval` | `skipped` | skipped | skipped | 否 | 不命中 |

`scored` 的 `creditedScore` 可以是 0；零分不是失败或证据不足。
`invalid` 的 `earnedScore` 只作诊断，`creditedScore` 固定为 0。

`unavailable`、`errored` 与 `skipped` 的 `creditedScore` 是 `null`。
聚合不得过滤 invalid 后只平均幸存的 scored Attempt，也不得把 null 当零分。

## Eval 折叠与退出码

退出码不直接扫描原始 Attempt。
它先按 `(experimentId, evalId)` 折叠同一 Eval 的多次 Attempt，与现有重试和首过即停口径保持一致：

- 通过制按 `passed > failed > errored > skipped` 折叠：任一 Attempt 通过就吸收同题较早的失败；没有通过时，确定失败压过执行错误；
- 计分制按 `scored > invalid > errored > unavailable > skipped` 折叠：任一 Attempt 成功形成分数就吸收同题较早的无效或错误尝试；`creditedScore: 0` 的 scored Attempt 仍是成功；
- `earlyExit` 只在得到 `passed` 或 `scored` Attempt 后省略同题未派发次数。

`InvocationCompletion.status: "complete"` 时，只要任一折叠后的 Eval 是 `failed`、`invalid`、`errored` 或 `unavailable`，退出码就是 1；全部是 `passed`、`scored` 或显式 `skipped` 才是 0。
`incomplete`、required reporter 写失败、未捕获崩溃与中断继续使用 Runner 已有的 1 / 2 / 130 契约。

因此一次先 invalid、后 scored 的重试最终不会把进程判红，但 invalid Attempt 的 `creditedScore: 0` 仍留在分数聚合里，不能因退出码折叠而消失。

## `totalScore` 聚合

官方 `totalScore` 只读取计分 Attempt 的 `creditedScore`；`earnedScore` 永远只是诊断字段：

1. Attempt 投影：`value = creditedScore`；通过制 Attempt 为 `null`；
2. 同一 `(experimentId, evalId)` 内：对所有非 null value 取算术平均；invalid 的 0 进入分子和分母，unavailable / errored / skipped 的 null 不进分母；没有非 null value 时结果为 null；
3. 同一 Experiment 跨计分 Eval：对所有非 null 的题级均值求和；没有任何可用题级值时结果为 null。

例如同题两次 Attempt 分别为 scored 100 与 invalid 0，题级分数是 50，即使该 Eval 的退出码折叠结果是 scored。
MetricValue 的 `samples / total` 继续显示被 null 排除的样本缺口，不能把 null 悄悄补成零。

## `niceeval show`

Attempt 摘要先显示终态，再显示判定与分数：

```text
invalid · earned 7.2 · credited 0
✗ assert · runtime 配置必须有效
  fact: fileChanged("experiments/local.ts")
  producer: evals/runtime/eval.ts:18
  consumer: evals/runtime/eval.ts:23
✓ score · 回答质量 · 7.2 / 10
  consumer: evals/runtime/eval.ts:24
```

同一 Fact 同时用于判定与计分时，show 展示一个 Fact 结果和两个 consumer 位置。
它不能复制成两次 evaluator 调用，也不能隐藏 `earnedScore` 与 `creditedScore` 的差异。

Legacy Judge sidecar 继续使用现有 Judge 行展示 score、threshold、evidence、optional 与 points，不伪装成 Fact。
Judge points 先进入 Attempt 的 `earnedScore`，官方 `totalScore` 随后仍只读取折叠后的 `creditedScore`；默认 soft Judge 继续只进入 legacy `examScore`。

Fact use 提供 `key` 时，show 与 JSON 都保留它。
人读标题优先显示 label；没有 label 时才显示 key，不能把 key 改写成 matcher name。

unavailable 需要同时显示 Fact reason、所需证据通道、Agent 创建时支持声明与运行中降级 provenance。
`assertIfCovered` 的 `notApplicable` 使用独立标记，不能显示成 passed。

结果列表的 failure 分组包含通过制 `failed` 与计分制 `invalid`。
`unavailable` 和 `errored` 进入 error 分组；`skipped` 保持独立。

## JSON 与旧 Run

CLI JSON 原样公开 `evaluationKind`、Attempt 终态、`earnedScore`、`creditedScore`、Fact 结果、Fact 用途结果与隔离的 `legacyJudgeAssertions`。
普通 Fact 消费方不需要从展示字符串、severity 或是否存在 points 猜角色；只有 legacy Judge adapter 读取 sidecar 的既有字段。

schema 不兼容的旧 Run 遵守 Record 的既有版本提示。
CLI 不把旧 `AssertionResult` / `ScoreEntry` 启发式转换成 Fact Record，也不把两种 schema 放进同一次聚合。
