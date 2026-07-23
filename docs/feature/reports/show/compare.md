# 对照矩阵：多个 `--exp` 的逐 eval 对照

同批 eval 在多个条件（baseline vs 记忆、不同 agent、不同 flags）下各跑了一遍时，核心问句是「同一道题在两个条件下各自怎样」——哪些题翻转了判定、token 与成本差在哪。`--exp` 出现两次以上时，缺省切片输出这张对照矩阵：逐 eval 一行，逐条件一组列，行尾翻转标记，尾部对基准的汇总差值。

榜单回答「每个条件整体多好」，对照矩阵回答「每道题在条件间怎么变」；两者消费同一套 Scope 选择，只是投影不同。对照矩阵是报告库 [`DeltaTable`](../library/metric-views.md#deltatable) 在 show 上的零配置装配——`--exp` 出现顺序即 `conditions`（首个是基准），eval id 前缀即 `evals`；聚合口径、数据形状与展示语义单源在该组件小节，不在此重复声明。

## 条件与配对

- 每个 `--exp` 是一个对照条件，按出现顺序排列，**第一个是基准**。每个 `--exp` 必须恰好解析到一个 experiment；前缀匹配到多个时按用法错误退出并列出全部候选 id。
- 携带与跨快照拼入的历史执行沿用 `↩ <时距>` 时效标注；`--fresh` 照常收窄。

## 输出

```sh
$ niceeval show --exp memory/claude-baseline --exp memory/claude-mempal
对照 · 2 个条件 · 配对身份 eval id · 基准 memory/claude-baseline
共同 7 · 仅 claude-baseline 0 · 仅 claude-mempal 1

eval                                claude-baseline           claude-mempal          Δ claude-mempal
memory/agent-037-updatetag-cache    ✓   512.3k   $0.71        ✓   305.1k   $0.44         -207.2k   -$0.27
memory/repomod-hello-world-api      ✓   688.9k   $0.95        ✓   701.2k   $0.98          +12.3k   +$0.03
memory/swelancer-manager-proposals  ✗   621.0k   $0.83        ✓   298.4k   $0.41    ⇄    -322.6k   -$0.42
memory/terminal-cancel-async-tasks  ✓   455.7k   $0.63        ✓ ↩ 2d 402.0k $0.55         -53.7k   -$0.08
memory/terminal-pypi-server         ✗   890.1k   $1.21        ✗   910.4k   $1.30          +20.3k   +$0.09
memory/tool-call-observability      ✓   102.6k   $0.14        ✓    98.2k   $0.13           -4.4k   -$0.01
memory/uv-lock-refresh              —                         ✓   511.8k   $0.70               —        —
memory/flaky-retry ×2               ✗   731.5k   $0.99        ✓   644.0k   $0.87    ⇄     -87.5k   -$0.12

汇总                                 4/7 通过   4.0M   $5.46   7/8 通过   3.9M   $5.38
共同题对基准                                                   通过率 +28.6pt · tokens -642.8k · 成本 -$0.78
```

- 头两行报条件数、配对身份、基准与配对覆盖（共同 / 仅某条件的 eval 数）。
- 条件超过两个时，每个非基准条件各带自己的 `Δ` 列组，全部对第一个 `--exp` 求差；输出变宽是允许的，宽内容交给终端横向滚动，不为省列宽合并语义。
- 数值列跟随 Scope 主读数映射（[题型构成与主读数](../library/metrics.md#题型构成与主读数)）：通过制显示 verdict，计分制在 verdict 位显示挣分（如 `3 pt`；计分制没有满分声明），混型按题型分段。

聚合口径——翻转标记、占位与时效、每格的折叠规则、`汇总` 与 `共同题对基准` 的计算方式、混型分段——单源在 [`DeltaTable`](../library/metric-views.md#deltatable)；本页只保留 CLI 呈现的行为与示例。

## 与切片、形态组合

对照条件是范围输入，与切片、形态正交：

```sh
niceeval show --exp A --exp B --usage        # 逐 eval 的用量矩阵：每条件一组 usage 列
niceeval show --exp A --exp B --json         # 对照矩阵的结构化输出（信封与指针见 --json 分篇）
niceeval show pr-6058 --exp A --exp B        # 收窄到单题：一行矩阵，从这里拿两侧 locator 继续下钻
```

`--history` 与重复 `--exp` 正交且不变形：时间轴本来就按 experimentId 分节，条件只是收窄节集合。

## 边界

- 与 `--report` 互斥（缺省切片被报告树替换时，对照矩阵不再适用；自定义报告里的对比组件用 `DeltaTable`）。
- `@<locator>` 与重复 `--exp` 互斥（[范围契约](../show.md#选择结果范围)）。
- 只想看所有条件的整体前沿时用单个 `--exp` 收窄后的[榜单散点](default-report.md)；矩阵服务逐题归因，不服务排名。

## 相关阅读

- [`DeltaTable`](../library/metric-views.md#deltatable) —— 对照矩阵的组件单源：聚合口径、`deltaTableData` 形状与展示语义。
- [默认榜单](default-report.md) —— 单条件范围的缺省切片与折叠口径。
- [`--usage`](usage.md) —— 用量列的组装口径。
- [`--json`](json.md) —— 信封与逐视图指针。
- [用例 · 跨条件归因](../use-case/cli-cross-condition-attribution.md) —— 从「哪些题翻转了」到「为什么」的全流程。
