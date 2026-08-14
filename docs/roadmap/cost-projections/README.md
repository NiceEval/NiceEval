# 成本投影

## 要解决的问题

使用者需要在同一份 Report 中区分 provider 当时报告的金额与按固定价格表得到的估算。两类读数都必须说明样本命中范围、缺口和币种，不能让缺失看起来像零成本。

价格表属于报告作者的声明，不属于运行时发生的事实。历史 Record 因而保持原样；同一次导出的报告也始终能说明使用了哪一份价格内容。

## 核心心智

```text
Core + sealed Observability Usage
              │
              ▼
      Cost Analysis value  ◀── PricingProfile
              │
              ▼
        closed cost value
              │
              ▼
Report page / show / view / static export
```

`PricingProfile` 是 Report module source closure 中的不可变值。它声明报价币种、小数位与适用的 Core execution identity。
它也声明 provider、时间条件和 token／request 费率。规范化后的全部内容产生 content identity。

成本解释只读取 Core 和固定 `niceeval.observability` family 的 Attempt Usage；其 envelope 的 `schemaVersion` 是 `1`。Core 提供尝试、成员关系、execution identity 与 origin Run 时间。
Usage 提供 provider、token bucket、request 和 provider-cost observation。没有其它 Record 输入，也没有额外的可计费主体或绑定附件。

`provider-cost` 是 provider 当时观察到的金额。它保持独立事实，不被 Profile 改写。
没有该金额时，Usage 与 Core identity 必须同时精确匹配 Profile coverage。只有这时 token 或 request 才能形成 estimate。

## 成本读数

成本值有两个独立维度：

| 维度 | 值 | 含义 |
|---|---|---|
| state | `available` | 所有被选 Slot 都有可合并的报价币种读数。 |
| state | `partial` | 已知金额仍可呈现，但至少一项 Slot、Usage collection、币种或 coverage 有缺口。 |
| state | `unavailable` | 没有可报告的报价币种金额。 |
| basis | `observed` | 只有 provider-observed amount。 |
| basis | `estimated` | 只有由 Profile 得到的 amount。 |
| basis | `mixed` | 同一报价币种同时有两类 amount。 |
| basis | `unavailable` | 没有可报告的 amount。 |

零是合法的 observed 或 estimated amount。缺少 Usage 或不可读 Attachment 时，结果保留具名 reason。
partial collection、未报价 coverage、不同币种或不存在 Member 同样如此，绝不降格为 `0`。

一个 Profile 只报价一种 currency。相同币种的 observed 与 estimated 分量可以分别汇总，再形成 combined total。不同币种的 observed amount 原样列出，不换算、不合并，也不猜汇率。

## 不可改写边界

Profile、estimated amount、汇率和总计不进入 Record。Report 不写回 Usage，不修改 provider-cost，也不从当前配置、文件、网络或今天的价格补造历史事实。

本方向没有重新定价操作、价格刷新命令或写回路径。改变价格内容会形成另一份 Profile content identity 与另一份 Report execution；它不会改写旧的 execution、静态导出或 Record。

Profile 同样不形成持久 schema。`show`、`view` 与静态导出只输出闭合值及其 content identity。

## 范围

本方向包含：

- `PricingProfile` 的规范化、内容身份、coverage 与 exact-decimal 规则；
- 从 Core 与 Observability Usage 得到 observed、estimated、mixed、partial 与 unavailable 成本值；
- 在既定 Report 页面、CLI 和静态页面中交付分量、coverage 与 reasons；
- 同一 Report execution 中固定的 Profile identity 与计算结果。

本方向不包含：

- 新的 Record family、Core field、价格绑定载荷或迁移；
- provider 调用、网络价格查询、货币换算、汇总回填或执行调度参数；
- 成本专用 CLI 命令、flag、退出码或 Eval Assertion。

## 入口

- [Library](library.md) —— Profile、coverage 与闭合成本值的公开形状。
- [Architecture](architecture.md) —— 输入边界、优先级、生命周期和不变量。
- [CLI](cli.md) —— 既有 Report 命令中的人类、JSON 与静态呈现。
