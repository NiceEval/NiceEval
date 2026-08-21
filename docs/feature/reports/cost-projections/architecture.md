# Report 成本投影 —— Architecture

## 输入与所有权

```text
sealed Core origin                 sealed Observability Usage
execution model · origin Run start       provider-cost · token · request
             │                                      │
             └──────────────────┬───────────────────┘
                                ▼
                  ReportDefinition.pricing
                                │
                                ▼
                    closed CostProjection
                                │
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
 target Page → terminal text / machine JSON   ClosedSiteRevision → web / static
```

Record 只拥有 Core 和 Usage。Profile 属于 Report module；Host 在目标 Page 或全站构建时验证 Profile、捕获 Analysis 已签发的
闭合投影并交付 bytes。CLI 与浏览器只呈现关闭结果。没有任何方向把 Projection、Profile 或总计写回 Record。

Runner 的 `estimatedCostUSD` 是另一条运行期 Calculation。它从 Config/runtime price table 取得输入，并且即使 Usage 已有 observed
`costUSD` 也独立计算。Runner 只把它交给 `maxCost`；Report 不读取它。

## selector 与费率

Profile selector 始终以 Core 中持久化的 execution `model` 匹配；显式存在 `provider` 时再与 Usage observation provider 合取。内置目录
coverage 有意省略 provider，因为当前 observation provider 是生产该 Usage 的 adapter/agent 身份，不是可靠的 billing provider。

origin Run start 只由 coverage `effective` 的
`startsAt` / `endsAt` 半开区间匹配。origin model 为 `null` 时不能猜测 model。`executionIdentityDigest`、`agentId` 与
`reasoningEffort` 只有显式出现时才作为额外合取条件。它们不提供优先级，也不从当前配置补值。

Profile 只报价 USD。token charge 的 bucket 是 `input`、`output`、`cache-read` 或 `cache-write`，以 `perMillionTokens` 表示；
request charge 的唯一数值字段是 `ratePerRequest`。每个 rate-card provenance 固定为
`{ kind: "declared-rate-card", source, asOf }`，并参与 Profile identity。

同一个 slot-provider 不能得到两条 coverage 的静默选择。Profile definition 在 coverage 彼此重叠、重复 rate、非法区间、非法 decimal、非 USD
currency 或不合法 provenance 时失败。缺少 sealed 事实和不适用 rate 则是可呈现的 projection reason，而不是 definition error。

## ledger 决定顺序

Analysis 先读取每个 slot 的 Usage provider，再为每个坐标建立一项 ledger entry：

1. 若任一 `provider-cost` 存在，该坐标锁为 `observed`。全部 observed cost 必须是 USD，才会形成该 entry 的 exact USD 值。
2. 没有 `provider-cost` 时，Analysis 以 Profile selector 与 effective 条件匹配 coverage。每个 token bucket 与 request kind 都必须有
   明确 charge，才形成
   `estimated` entry。
3. 无法形成前两种 entry 时，状态为 `unavailable`，并保留有限的 closed reason code。

provider observed branch 与 Profile estimated branch 在同一 slot-provider entry 中互斥。任一 `provider-cost` 已存在时，只保留 observed
branch。

完整 reason 词表只有：

- `member-not-recorded`
- `core-invalid`
- `origin-run-unavailable`
- `execution-model-not-recorded`
- `usage-not-recorded`
- `usage-unavailable`
- `usage-unsupported`
- `usage-invalid`
- `usage-collection-partial`
- `pricing-coverage-not-found`
- `pricing-coverage-unpriced`
- `pricing-charge-not-found`
- `observed-cost-other-currency`

## 精确数值与完整度

Analysis 对每个 known USD entry 使用 exact decimal 计算。`aggregate.kind: "total"` 的 `total` 是这些已知贡献的 exact sum；
`aggregate.kind: "mean"` 的 `numerator / denominator` 保留 exact rational。一个 logical Slot 在分母中只计一次，provider entry
不会把它重复计数。Host 和显示组件只格式化 Analysis 输出，不能重算。

`available` 要求每个应解释的 slot-provider 都有 known USD entry。至少一项 known、同时有 unavailable 坐标时是 `partial`。
没有 known USD entry 时是 `unavailable`。合法零仍是 known entry；没有值只能由 `unavailable` 和 reason 表达。

## 目标执行、全站与 revision

`show` 只关闭目标 Page 实际请求的 projections，并把它们放进该次 machine 文档的顶层 `projections`。它不枚举其它 Page，
不建立 page set，也不形成 revision identity。

`view` 与 `view --out` 执行 Report 的全部已声明 Page 和参数实例。全站 closure 写出所有页面所需 projections 的 canonical union 到
`_niceeval/data/projections.json`。这个文件的 bytes、Profile identity、页面和其它资源都进入 `ClosedSiteRevision` identity。

`pages` 是 Report 的完整页面集合。详情只有在作者声明 `presentation: "overlay"` 的 ParameterizedPage 并由它枚举时才进入全站；Host 不会补建详情页面或 route HTML。

## 生命周期与审计

Profile 在 Report module 装载时规范化，并在每个 target execution 或 site build 中按其 content identity 验证。重复安装的 NiceEval
通过 `definition/v2` 与 `pricing-profile/v1` 的 `Symbol.for` descriptor 重验定义与 Profile，不依赖对象地址或 `instanceof`。

静态目录保存根 `index.html` app shell、closed HTML fragments 和 `_niceeval/data/projections.json`，所以离线读者不需要 Record、Profile source 或网络。下一次 build 可以
加载不同 Profile，但不能改变已发布 revision。

## 不变量

- Usage `costUSD` 只保留 provider/adapter observed USD 成本；它从不由 Report 或 Runner estimate 回填。
- Profile 只从 `ReportDefinition.pricing` 进入 Report；省略声明时 `defineReport` 固定使用 `builtInPricingProfile`，`ctx.report.pricing` 只读。
- `costUSD(profile)` 与 `totalCostUSD(profile)` 都要求显式的已声明 Profile。
- 每个 slot-provider 在 observed、estimated 与 unavailable 之间恰有一种 ledger 状态。
- `show` 只交付目标 Page 的 projection closure；view 与 static 交付所有声明 Page 的 closure。
- `_niceeval/data/projections.json` 属于 revision bytes，不能由浏览器再计算或替换。
