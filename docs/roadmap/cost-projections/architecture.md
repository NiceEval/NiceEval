# 成本投影 —— Architecture

## 输入与所有权

```text
Core member + origin Attempt + execution identity
              │
              ├── sealed Observability Usage
              │
              └── PricingProfile in Report source closure
                                │
                                ▼
                    closed CostProjectionValue
                                │
                                ▼
               ReportExecution / text / web / static output
```

Record 只拥有 Core 和既有 Observability Usage。Analysis 只解释这两类事实，并保留 Sample 的分母、Slot 与问题。
Report module 拥有 Profile source closure。ReportExecution 拥有一次闭合的成本值和 Profile content identity。CLI 只呈现 execution。

成本方向不改变 Record 的五个固定 family，也不增加 Core 字段。Usage observation 与 Core execution identity 的关系只由同一 origin Attempt 提供。
它不能另行持久化一份映射。

## 分量选择

成本先按 origin Attempt、provider 与 Core execution identity 划分分量。每个 Usage observation 只属于它载明的 provider。
它不能被另一个 provider 的 coverage 解释。

对每个分量按以下顺序决定金额：

1. 该 Attempt 和 provider 存在 `provider-cost` observation 时，所有同币种 observed amount 都保持为 observed 分量。
2. 存在 observed amount 的 provider 分量不再估算 token 或 request。Usage 没有事实把一条 observed amount 与若干原子 observation 逐一对应，因此这条规则避免重复计费。
3. 没有 observed amount 时，Profile 必须以相同 provider、execution identity 与 origin Run `startedAt` 命中唯一 priced coverage。
4. 只有 coverage 明确列出的 token bucket 或 request kind 才使用 exact decimal 计算 estimate。
5. 未匹配 coverage、unpriced coverage、缺少 charge、collection partial 或读取问题产生具名 reason。

Core identity 是 opaque 的稳定比较值，不是可由成本代码解开的配置说明。它不足以支持某项报价时，投影必须保持 partial 或 unavailable。

## 币种、状态与数值

Profile 的 currency 是 quote currency。observed 与 estimated amount 只有在这个 currency 内才可以相加。
其它 currency 的 observed amount 进入 `observedOtherCurrencies`。它不进行 FX，也不加入 combined total。

`available` 要求 Sample 中每个应解释 Slot 都具备完整 quote-currency 分量。任一成员不存在、Core 或 Usage 不可读时，结果为 `partial`。
collection partial、coverage 不匹配、unpriced 或币种不一致也产生 `partial`。没有 quote-currency amount 时是 `unavailable`。

`observed`、`estimated` 与 `mixed` 只说明已知 quote-currency 分量如何得到。它们可以与 `partial` 组合。合法零 amount 保持为数值；未知 amount 只能是缺失状态和 reason。

## 生命周期与审计

Profile 在 Report module 装载时被规范化。一次 Report execution 对每个已请求成本值只计算一次。
它保存 Profile identity、coverage、分量与 reasons。相同 execution 的 terminal、web 和静态输出读取同一份闭合值。

静态导出保存已经闭合的展示结果，因此离线读者不需要 Record、Profile source 文件或价格服务。下一次 view rebuild 可以加载另一份 Report source closure，但不能变更已经发布的 revision。

Profile 不写入 Record，也不通过 `show`、`view`、静态导出或任何维护路径写入价格。没有网络刷新、重新定价 flag、汇率服务或估算金额回填。

## 失败与验收

Profile 条目的时间区间重叠、非法 selector、非法小数位、重复 charge 或不合法 decimal 是 Report definition error。
Record / Usage 的 unavailable、unsupported、invalid 与 partial 是可呈现的数据问题。它们不会被转换为 CLI warning、零成本或额外事实。

生产验收使用真实 `show`、`view` 与 `view --out`：

- observed-only、estimated-only、mixed、partial 与 unavailable 都显示 basis、content identity 与 reasons；
- 相同 provider 的不同 Core execution identity 不串用 coverage；
- 不同 currency 的 observed amount 保持可见且不计入 total；
- 修改 Profile 内容形成新的 identity，原 Record 与已经导出的结果不变；
- 同一 execution 在 text、web 与静态面显示相同分量与 coverage。
