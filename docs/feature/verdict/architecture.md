# Verdict 与 Fact use

Fact producer 只描述一项证据。`t.check`、`await t.require` 和 `t.score` 才让它影响 Attempt。
同一个 Fact 最多有一个 verdict use 和一个 score use；两种用途共享同一次求值结果。

## 通过制

通过制只观察 verdict use 与已消费 Fact 的结果：

```text
任一已消费 Fact 或 verdict use unavailable / errored  → errored
任一 verdict use failed                               → failed
显式 t.skip(reason)                                   → skipped
否则                                                   → passed
```

`t.check(fact)` 登记检查并继续执行。`await t.require(fact)` 在当前位置立即求值；不通过、不可用或 evaluator error 时停止依赖它的后续代码，并将同一条 use 如实写入结果。
Score Fact 必须先用 `.atLeast(n)` 形成 threshold view，才能登记 verdict use：

```typescript
const answerQuality = turn.judge.autoevals.closedQA("回答是否切题？");
t.check(answerQuality.atLeast(0.8), { label: "回答质量" });
```

没有“观察但不消费”的 Judge 路径。创建后从未消费的 Fact 是作者错误，且不会发出 evaluator 请求。

## 计分制

`defineScoreEval` 另外折叠 score use：

| score terminal | 含义 | 四态汇总 |
|---|---|---|
| `scored` | 所有已消费 Score Fact 与直接分数均有效 | `passed` |
| `invalid` | 某个 verdict use failed | `failed` |
| `unavailable` | 已消费 Fact 不可用 | `errored` |
| `errored` | evaluator 或执行错误 | `errored` |
| `skipped` | 明确跳过 | `skipped` |

`t.score(label, fact, { max })` 将 Boolean Fact 映射为 0 或 `max`，将 Score Fact 的归一化值映射到 `[0, max]`。同一 Score Fact 若已有 score use，不再进入 `examScore`；它只进入这次 Attempt 的 `totalScore`。

## 不可用与 evaluator error

`unavailable` 不是通过，也不是 Agent 答错。缺少 Judge 模型或 key、证据不足、或 Judge 调用的传输失败，都会以普通 Fact result 和对应 use 的原因落盘，并令消费它的 Attempt `errored`。

非法 Judge 响应、非有限分数以及区间外分数是 evaluator error，不会被截断或改写为分数。实际已配置端点的 precheck 失败是 setup error，不伪造 Fact；未配置模型或 key 时不做网络 precheck。

CLI、show、view、report 和失败反馈都从 `factResults` / `factUses` 选择同一条通用摘要。Judge 只是其中的一个 ScoreFact producer。
