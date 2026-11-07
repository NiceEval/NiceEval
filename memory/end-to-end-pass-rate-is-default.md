# 裁决：默认成功率包含 errored（2026-07-15）

`taskPassRate`、`executionReliability`、`endToEndPassRate` 三指标拆分继续保留，但默认报告选择 `taskPassRate` 的决定被推翻。

## 被推翻的表现

`taskPassRate` 把 `errored` 记为 `null`。当默认散点、实验列表、运行总览和排序都把它简称为“成功率”时，`2 passed / 5 errored` 会显示成 `100%`，并可能排在实际稳定交付的 experiment 前面。覆盖率角标 `2/7` 和旁边的 error 计数不能修复主数字的错误语义：用户按“成功率”比较的是一套配置端到端产出成功结果的概率，不是条件于“已经形成可信判定”的答题质量。

`errored` 也不只等于可忽略的云基础设施抖动。它包括环境、超时、adapter / agent runtime、作者错误，以及非 optional 断言证据不可用。把整个集合排除在默认成功率之外，会同时隐藏配置缺陷、接入不稳定和运行失败。

## 定稿

- 无限定词的 `Pass rate / 成功率` 与所有默认总览统一使用 `endToEndPassRate`：每个 passed attempt 记 1，failed / errored 记 0，skipped 记 `null`；仍按 Reports 的题内、跨题两级规则聚合。
- `ExperimentComparison` 的成本散点、`ExperimentList` 的固定列与默认排序、`RunOverview` 都使用 `endToEndPassRate`。
- `GroupSummary` 保持 eval 级折叠计票，再算 `passed / (passed + failed + errored)`；它与端到端指标的 attempt 两级聚合服务不同粒度，但都不排除 errored。
- `taskPassRate` 继续作为诊断指标，表达 `P(passed | attempt formed a trustworthy verdict)`。展示时必须使用 `Task pass rate / 可判定任务通过率` 这类限定名称，不能简称成功率，也不能驱动默认排名。
- `executionReliability` 继续表达一次运行能否形成可信判定。需要归因时把三指标并排，不把 failed 与 errored 合并成同一 verdict。
- skipped 是主动未执行或无判定样本，不进入这三个指标；error 是实际执行过但未成功交付，必须降低默认成功率。

这项裁决细化并部分推翻 [`external-review-round2-rulings`](external-review-round2-rulings.md) 的 passRate 项：三拆本身正确，错误在于拆分后仍让条件指标占据无条件的默认“成功率”位置。
