# Assertions —— 展示

show、view、报告列表、source 标注和 failure feedback 都读取同一份 `factResults` 与 `factUses`。没有 Judge 专用行、旧 Assertion 摘要或 sidecar 回退。

## Attempt 详情

详情按 source order 显示两类行：

```text
Fact      judge:closedQA("回答是否清楚？")   scored      score 0.86
Fact use  Judge clarity                         passed      assert atLeast 0.8
Fact use  Answer quality                        scored      17.2 / 20
```

Fact 行显示 producer location、依赖、outcome、expected/received、reason、explanation 和 evidence。use 行显示 consumer location、method 或 score input、threshold/max、earned 和稳定 key。

`explanation` 显示 evaluator rationale。`evidence` 只显示已裁剪、脱敏的判分材料。unavailable 和 errored 均保留其结构化原因，不能显示成 0 分或通过。

## 通用摘要

列表和 CLI history 从 Fact/use 图投影一条摘要，优先级固定：

1. 非成功的 score Attempt 显示 terminal、earned、credited 与首个 issue。
2. 失败、unavailable、errored 或未到达的 Fact use 显示 use 标题、outcome 与 reason。
3. 已消费 Fact 的 unavailable 或 evaluator error 显示 Fact 名称和原因。
4. 成功 score Attempt 显示 earned 和 credited。
5. 已消费且成功的 ScoreFact 显示 Fact 名称和 normalized score。

剩余同类条目计入 `+N more`。若没有 Fact/use 摘要，执行 error 或 skip reason 才作为图外摘要。

## Source 与 failure feedback

source view 用 producer location 标注 Fact，用 consumer location 标注 use。同一 Fact 同时用于 verdict 和 score 时只显示一个 Fact 结果和两个 use，不重复 evaluator。

failure feedback 选择导致终态的首个 Fact/use，并携带 label、Fact 名、expected、received、reason 和剩余数量。不存在可归因 Fact/use 时，才显示结构化 execution error。

## 计分读取

成功且已消费、没有 score use 的 ScoreFact 每个 Fact 一次进入 `examScore`。有 score use 的 Fact 只通过 `creditedScore` 进入 `totalScore`，避免重复计算。

Braintrust 对成功、已消费 ScoreFact 导出 normalized score。存在 verdict use 时，它还用稳定 use key 导出 0 或 1 的 threshold verdict。unavailable 和 evaluator error 只留在 metadata。
