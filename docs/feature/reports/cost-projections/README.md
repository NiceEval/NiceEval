---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Report 成本投影

本目录是 Report 成本投影的唯一完整契约。Report Feature 的上层页面只保留入口和整合边界，不重复这里的 Profile、ledger、数值或 machine 形状。

## 要解决的问题

Report 要在固定 Sample 中说明已观测费用和按随包目录或显式 rate card 得到的估算，同时不把缺口、另一种币种或运行器护栏伪装成 USD 成本。
每个读数都必须能回到 sealed Usage、持久化 origin 或 Report 模块中的已验证 Profile。

## 核心心智

```text
Core origin + sealed Usage                  Report module
provider-cost / token / request ───────► PricingProfile
             │                                  │
             └──────────────┬───────────────────┘
                            ▼
                  slot-provider cost ledger
                            │
                            ▼
             target Page / show / view / static export

Runner config/runtime price table ─► estimatedCostUSD ─► maxCost
                                              ╳
                                      not a Report input
```

`PricingProfile` 是 Report source closure 中的不可变值。它固定 USD、rate-card provenance、coverage 与 content identity。Report
省略 `pricing` 时使用 NiceEval 随包发布的完整 `builtInPricingProfile`；作者无需选择模型或复制公开费率。
它不会修改 Record，也不会读取当前网络、今天的价格或 Runner estimate。

sealed Usage 保留 provider/adapter observed `costUSD`、token bucket 和 request 的原子事实。origin Core 提供 provider 的匹配坐标所需的
model、Run `startedAt` 和可选 narrow facts。Analysis 从这两类 sealed 事实与 Report 的 Profile 形成成本投影；Report Host 只验证、
捕获闭包和呈现它。

## 一条方向

价格输入只从 `ReportDefinition.pricing` 进入，组件从只读 `ctx.report.pricing` 读取同一值。未声明时，`defineReport` 固定填入
`builtInPricingProfile`；显式声明的 Profile 整体替换默认目录。成本 Measure 仍显式传入最终 Profile，不从 Config、Host 或 Runner
取得另一份价格输入。

内置目录的 coverage 只按完整 execution model 字面值匹配。它不把 Usage 的 observation provider 当作 billing provider，不去掉
provider 前缀或日期，不用 input 价格填补 cache bucket。未知 model 或目录未声明的 bucket 保持 unavailable；每个目录条目显式声明
model request 的零费率，因此零不是运行时 fallback。

每个 slot-provider 的 ledger 只有 `observed`、`estimated` 或 `unavailable`。任一 sealed `provider-cost` 会锁定 observed 路径；
没有该事实时，匹配到的 Profile 才可解释 token 与 request。不能匹配、缺少费率、非 USD observed cost 或 Usage 问题都会留下有限 reason。

## USD 与精确数值

Profile 和投影只报告 USD。非 USD 的 observed cost 不会换算、汇总或由 Profile 改写，而是保留
`observed-cost-other-currency` reason。
零是合法 USD 成本。

总和使用 exact decimal；每 logical Slot 的平均保留 exact `numerator / denominator` rational。显示可按页面的明确格式规则舍入，但不能使用 binary floating-point
重新计算 total 或 mean，也不能把 unavailable 当作零。

## 不可改写边界

Profile、估算 ledger、汇率和总计不进入 Record。Report 不写回 Usage、不修改 observed `costUSD`，也不把 Runner 的
`estimatedCostUSD` 重新标作 Report observed 或 estimated entry。

同一 Profile 内容产生同一 content identity。改变 Profile 会形成新的 Report definition 与新的目标 Page 或全站 closure；它不改写历史
Run、先前 `show` 输出或已导出的 `ClosedSiteRevision`。

## 范围

本方向包含：

- `definePricingProfile()`、USD rate card、selector / effective coverage 与 content identity；
- sealed Core 与 Usage 到 slot-provider ledger 的单向投影；
- `costUSD(profile)`、`totalCostUSD(profile)`、有限 reasons 与 machine projection；
- target `show`、完整 `view`、静态站与 revision identity 中的闭合成本内容。

本方向不包含：

- 新的 Record family、Core field、价格附件、货币换算或价格刷新；
- 价格专用 CLI flag、网络价格查询、重新定价、回填或执行调度；
- Runner estimate 的 Report 输入，或成本专用 Eval Assertion。

## 入口

- [Library](library.md) —— Profile、ledger、费率与闭合成本值的公开形状。
- [Architecture](architecture.md) —— 输入边界、锁定顺序、revision 与不变量。
- [CLI](cli.md) —— 人读、machine、target show、全站 view 与静态呈现。
