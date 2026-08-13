# 成本投影 —— Architecture

## 数据边界

```text
sealed Usage Attachment + sealed billing-subject bindings
                         + frozen AnalysisSample + PricingProfile
                                      │
                                      ▼
                             CostProjection Calculation
                         │
                         ▼
              immutable ReportExecution
                    ├─ show
                    ├─ view revision
                    └─ static report
```

`niceeval.usage/v1` 只保存实际执行时收集的原子 observation。
它不保存 total、price、estimated amount、FX 或跨币种结果。
`niceeval.billing-subjects/v1` 只把同一 Attempt 的 observation identity 绑定到精确 provider/model subject。
它不保存 rate、amount 或聚合，也不能由 Report 从当前 Experiment 配置补造。
`PricingProfile` 只存在于 Report source closure。
`CostProjection` 只存在于一个 `ReportExecution`。

这条边界禁止 record-repricing。
Report 不能写回 Usage，也不能修改已有 `provider-cost` amount、currency、provider、model subject 或 observation identity。

## 计费分量

Calculation 以 logical Slot 与精确 billable subject（provider + model）组成一个成本分量。
它先读取该 Slot origin Attempt 的 Usage observation，再遵守以下顺序：

1. 有同一精确 subject 的 `provider-cost` observation 时，采用其 amount 作为 observed。
2. 没有 observed amount 时，先从 binding Attachment 取得精确 subject，再查找唯一匹配 provider、model 与 origin Run startedAt 的 priced coverage。
3. 只对同一精确 subject 的匹配 charge token 或 request observation 进行 exact decimal estimate。
4. tool/request 没有精确 subject、coverage 明示 unpriced、没有匹配项、Usage 状态不完整或 collection partial 时，保留具名原因。

同一 Slot/subject 一旦有 observed amount，token/request observation 不参与该分量的 estimate。
这条优先级避免同一 provider 账单被 observed 与估算重复计入。
它不声称 provider observation 代表 Usage collection 之外的事实。

## currency 与小数

一个 `PricingProfile` 只报价一个 currency，并声明该 currency 的展示小数位。
计算使用 exact decimal；金额在同一 currency 内才可以相加。
observed cost 使用其它 currency 时原样保留，既不换算，也不进入 combined total。

Profile 的有效区间以 origin Run `startedAt` 判断。
该时间 basis 是计算假设，不能被写成 provider 当时计费的事实。
跨过区间、重叠 coverage 或不存在 coverage 都是 Profile validation 或 partial reason，不能猜一个未经 Profile 声明的价格。

## 状态与可观察语义

| 状态 | 含义 | 页面行为 |
|---|---|---|
| `available` | 所有 Sample Slot 都有同一 currency 的已知成本分量。 | 显示 basis、分量和完整 coverage。 |
| `partial` | 至少一个 Slot、collection 或 currency 不能进入完整 quote total。 | 显示已知分量与遗漏原因。 |
| `unavailable` | 没有可报告的 quote currency amount。 | 显示 Profile 与原因，不显示零总计。 |

`observed`、`estimated` 与 `mixed` 是 basis，不是 Record schema。
它们可以与 `partial` 组合。
例如一部分 subject 有 observed USD，另一部分按 Profile 估算 USD，同时两条 Slot 没有 Usage，即为 `mixed / partial`。

## 并发、生命周期与审计

Calculation 只消费 frozen `AnalysisSample` 和已构造的 Profile。
它不调用 provider，不打开另一个 Record reader，也不等待 Invocation。
同一 ReportExecution 的 Calculation 至多执行一次。

`view` 在输入变化后建立下一份 execution。
每份 execution 固定保存 Profile content identity、coverage 和 Calculation value。
静态导出只写这份固定 execution，断网读者无需 source Record 或价格服务。

## 失败、迁移与删除

Profile 的同 subject 重叠 coverage、非法 billable subject、小数位、currency、有效区间或重复 charge 是 Report definition error。
Usage 或 billing-subject bindings 的 unavailable、migration-required、migration-unavailable、unsupported 与 invalid 保持 Record data problem。
它们不会被变成 zero cost、未经 Profile 固定的价格或 CLI warning。

删除所有将 estimated amount 写为 `provider-cost` 的 producer 路径。
删除 ad-hoc price-table reader、网络刷新和 Record 回填路径。
`PricingProfile` 没有 durable schema。新的 binding Attachment 是 additive family，不改变 Usage 或 Record Core schema。
旧 Attempt 缺少 binding 时不得从当前源码或 model 配置回填。

生产入口验收以真实 `show`、`view` 和静态导出检查状态表。
它验证 Profile identity 随内容变化、Record 保持不变、同一 execution 只计算一次，以及 JSON 与 Human 页一致。
另一条真实切片在同一 provider 下使用两个 model，验证 coverage 精确按 subject 匹配且不串价。
不新增 Eval Assertion；CLI-only 部分由真实 CLI/E2E 旅程验收。
