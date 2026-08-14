# 成本投影

## 要解决的 Frog / DX 摩擦

使用者需要在同一份 Report 中看见实际 provider 计费、可复现的价格表估算，以及每个数值涉及哪些 Slot。
把新价格写回历史 Record 会让同一次运行随今天的价格改变，无法审计。
把缺失成本显示为零，又会把“没有采集到”伪装成“没有花费”。

## 核心心智

`niceeval.usage` 保存 provider 当时观察到的原子 token、request 与 provider-cost 事实。
`niceeval.billing-subjects` 保存 Usage producer 在同一 Attempt 中明确建立的 observation→provider/model 绑定。
`PricingProfile` 是 Report module 内的不可变价格内容。
`CostProjection` 是从 frozen `AnalysisSample`、Usage projection 和该 Profile 计算出的 Report Calculation value。

Profile 从不写入或改写 Record。
provider-observed cost 从不被价格估算取代。
估算是独立的 Report 读数，不是新的 Attempt 事实。

## 范围

本方向包含：

- 具有 content identity、精确 provider + model billable subject、coverage、币种、小数位和有效条件的 `PricingProfile`；
- 以新增的 Attempt-owned binding Attachment 保存可计费主体，不改写 `niceeval.usage/v1`；
- 以 Usage 原子 observation 形成 observed、estimated、mixed、partial 与 unavailable 成本读数；
- 在同一 currency 内明确展示 observed 与 estimated 分量；
- 通过既有 `show`、`view` 与静态 Report 页面交付结果。

本方向不包含：

- Record 内的价格表、估算金额、汇率、跨币种总计或回填；
- `niceeval cost`、`--reprice` 或把价格作为 `exp` 调度参数；
- provider 调用、网络价格查询、货币换算或未由 Profile 固定的价格推断；
- 新的 Eval Assertion。

## owner 与公开验收

Usage Attachment 拥有 observed facts。
Report module 拥有 `PricingProfile` 和 `CostProjection`。
`ReportExecution` 拥有一次固定计算结果；CLI 只呈现它。

本方向不新增 Eval Assertion。
公开行为由真实 `niceeval show`、`niceeval view` 与 `niceeval view --out` 旅程验收。
CLI-only 行为使用真实 CLI/E2E 入口，不用内部 Assertion 取代。

## 入口

- [Library](library.md) —— `PricingProfile`、coverage 和纯 Calculation 形状。
- [CLI](cli.md) —— 既有 Report 命令的人类、JSON、退出码与审计行为。
- [Architecture](architecture.md) —— Record 边界、币种、混合语义、失败和删除路径。
