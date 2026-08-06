# 不带选项的 `show`：默认报告的 text 面

没配 `config.report` 时，不带选项的 `niceeval show` 装载[内建报告](../library/built-in.md)，并渲染其首页。
尾部附 Attempts、追踪两页的索引。
配了就装载配置里的报告，取值链见 [Reports](../README.md#项目默认报告)；`--report standard` 按次回到本页这份。

页首是 `Hero`，随后是默认任务函数产出的 Notice、摘要、成本 × 主读数 points 和 Experiment rows。
散点 y 轴与实验列表主列跟随 Sample 的 [主读数映射](../library/measures.md#题型构成与主读数)：

- 通过制 Sample 使用通过率；
- 计分制 Sample 把 y 轴与主列换成总分，预排也按总分；
- 混型 Sample 摘要与实验列表两个主读数并排，散点画通过制那组。

整页组件树没有 `Section`，所以没有面板框；表与摘要格子各画自己的[数据格框](../library/layout.md#数据格框table-与-grid)，散点铺开占满可用列宽。
面板那层圆角框只随 `Section` 出现，用于 `AttemptDetails` 这类多区域详情页。
每个 experiment 的 eval 数与读数分母来自当前 Sample 的物理 attempts；报告不读取运行期选择计划作二次过滤。
实验列表保持 experiment → Eval → Attempt 层级。

Experiment、路径段组与 Eval / Attempt 各是一条实体行。Experiment 首格只显示 experiment id，例如 `compare/codex`；路径段组行显示自己的题数，例如 `downshift (6 evals)`。表中的结果与读数列承担比较所需的信息。

“平均 Tokens”列只计 input + output，不计缓存读写。
Experiment 与路径段组显示各自范围内跨 Eval 的宏平均，Eval 显示该题 Attempts 的平均，Attempt 显示该次精确值。
它不是总用量；总量与缓存明细由 `niceeval show ... --usage` 提供。

Sample 内实验声明了 `labels: { line: … }` 时（下例每个实验声明了 `line` 与变体轴 `memory`），散点按线归类：

```sh
$ niceeval show --exp memory
Eval 运行结果
最后运行 2026-07-12 18:08 · 由 5 份 Run 合成

平均每个 eval 成本（越低越好） × 端到端通过率 · 按 line 归类
 100% ┤
      │                                          A
  75% ┤   C
      │                             E
  50% ┤                       B
      │
  25% ┤                                   D
      └──────────┬──────────┬──────────┬──────────┬
               $0.45      $0.30      $0.15      $0.00

越靠右上越好

    系列     key                     成本      通过率
A   bub      memory/bub              $0.09     87.5%
B   claude   memory/claude-baseline  $0.35     50.0%
C   claude   memory/claude-mempal    $0.55     75.0%
D   codex    memory/codex-baseline   $0.16     25.0%
E   codex    memory/codex-mempal     $0.29     62.5%

claude   B → C   通过率 +25pt · 成本 +$0.20
codex    D → E   通过率 +37.5pt · 成本 +$0.13

╭─────────────────────────┬──────────┬─────────┬──────────┬────────┬─────────────────┬──────────┬────────╮
│ 实验                    │ 模型     │ Agent   │ 平均耗时 │ 通过率 │ 结果            │ 平均 Tokens │   成本 │
├─────────────────────────┼──────────┼─────────┼──────────┼────────┼─────────────────┼──────────┼────────┤
│ memory/bub              │ gpt-5.4  │ bub     │   1m 12s │  87.5% │ 7 通过 · 1 失败 │   112.4k │  $0.72 │
│ memory/claude-mempal    │ gpt-5.4  │ claude  │   2m 41s │  75.0% │ 6 通过 · 2 失败 │   301.2k │  $4.40 │
│ memory/codex-mempal     │ gpt-5.4  │ codex   │   2m 05s │  62.5% │ 5 通过 · 3 失败 │   201.7k │  $2.32 │
│ memory/claude-baseline  │ gpt-5.4  │ claude  │   1m 58s │  50.0% │ 4 通过 · 4 失败 │   188.0k │  $2.80 │
│ memory/codex-baseline   │ gpt-5.4  │ codex   │   1m 21s │  25.0% │ 2 通过 · 6 失败 │   129.3k │  $1.28 │
╰─────────────────────────┴──────────┴─────────┴──────────┴────────┴─────────────────┴──────────┴────────╯

其余页：
  attempts   Attempts   niceeval show --exp memory --page attempts
  traces     追踪       niceeval show --exp memory --page traces
```

表下逐实验的 Eval / Attempt 层级与下面 dev-e2b 例一致，不重复。
散点 x 轴是**平均每个 eval 成本**：表中成本列是实验总成本，除以题数得每题均值。
`better: "lower"` 反向渲染，越右越省。
图下是读值块，三段固定顺序：

- **方向提示**：两轴都声明了 `better` 时给一行，说明越靠哪个角越好。
- **读值表**：每行一个点——标记字母、系列、点名与两轴终值。字母把图上那个记号与这一行绑在一起；字母按表的顺序分配，series 按显示键字典序、series 内按 x 原始值升序。系列列只在同图有两个以上系列时出现，单系列时那一列全是同一个词、占宽度不给信息。
- **位移摘要**：连线的系列各一行，符号是原始差值——`成本 +$0.20` 表示每题贵了 $0.20。方向好坏由读数的 `better` 语义判断，摘要不替读者下结论。

轴刻度的精度跟随整齐步长：$0.45 这样的刻度不会印成 $0.4499999。

Sample 内没有任何 `line` 声明时按 agent 归类、不连线，图例行首是 agent 名：

```sh
$ niceeval show --exp dev-e2b
Eval 运行结果
最后运行 2026-07-12 18:09 · 由 3 份 Run 合成

平均每个 eval 成本（越低越好） × 端到端通过率 · 按 agent 归类
 100% ┤
      │
      │              A
  50% ┤
      │
      └──────────┬──────────┬
               $0.04      $0.00

越靠右上越好

    key                 成本    通过率
A   dev-e2b/codex-e2b   $0.03   66.7%

╭───────────────────┬──────────────┬───────┬──────────┬────────┬─────────────────┬────────┬───────╮
│ 实验              │ 模型         │ Agent │ 平均耗时 │ 通过率 │ 结果            │ 平均 Tokens │  成本 │
├───────────────────┼──────────────┼───────┼──────────┼────────┼─────────────────┼────────┼───────┤
│ dev-e2b/codex-e2b │ gpt-5.4-mini │ codex │   1m 58s │  66.7% │ 4 通过 · 2 失败 │ 198.9k │ $0.17 │
╰───────────────────┴──────────────┴───────┴──────────┴────────┴─────────────────┴────────┴───────╯
6/8 个 Eval · 6 次 attempt · 1 个曾有旧结果 · 1 个从未运行 · 2026-07-12T10:08:29.361Z

dev-e2b/codex-e2b
╭────────┬────────────────────────────────────┬────────────────────────────────────────────────────┬────────┬───────╮
│ 状态   │ 题目 / Attempt                     │ 结果                                               │   耗时 │  成本 │
├────────┼────────────────────────────────────┼────────────────────────────────────────────────────┼────────┼───────┤
│ ✓ 通过 │ memory/agent-037-updatetag-cache   │                                                    │        │       │
│ ✓      │   └─ @160iuj3h                     │ —                                                  │  2m 0s │ $0.09 │
│ ✓ 通过 │ memory/repomod-hello-world-api     │                                                    │        │       │
│ ✓      │   └─ @1sxmo0m1                     │ —                                                  │ 2m 58s │ $0.57 │
│ ✗ 失败 │ memory/swelancer-manager-proposals │                                                    │        │       │
│ ✗      │   └─ @1qrdcfq8                     │ equals(4) · received 3                             │  50.0s │ $0.05 │
│ ✓ 通过 │ memory/terminal-cancel-async-tasks │                                                    │        │       │
│ ✓      │   └─ @1pcdj0az                     │ —                                                  │ 2m 48s │ $0.13 │
│ ✗ 失败 │ memory/terminal-pypi-server        │                                                    │        │       │
│ ✗      │   └─ @13wrnsc4                     │ commandSucceeded() · received exit 1 · "…1 failed" │ 2m 53s │ $0.19 │
│ ✓ 通过 │ memory/tool-call-observability     │                                                    │        │       │
│ ✓      │   └─ @18etnsw5                     │ —                                                  │  18.1s │ $0.02 │
│ —      │ memory/uv-lock-refresh             │ 有旧结果 @1sk3lq02 · niceeval exp dev-e2b/codex-e2b │        │       │
│ —      │ memory/webhook-retry-budget        │ 尚未运行 · niceeval exp dev-e2b/codex-e2b           │        │       │
╰────────┴────────────────────────────────────┴────────────────────────────────────────────────────┴────────┴───────╯

其余页：
  attempts   Attempts   niceeval show --exp dev-e2b --page attempts
  traces     追踪       niceeval show --exp dev-e2b --page traces
```

同一个 Eval 有重试时，只出现一个 Eval 标题，下面按 attempt 序号逐条列 locator、该 Attempt 自己的判定，以及耗时 / 成本或失败原因：

```text
✓ 通过    memory/flaky-retry
  ✗       ├─ @1first01                            equals("ready") · received "pending"        18.0s     $0.02
  ✓       └─ @1second2                            —                                           21.4s     $0.03
```

携带或跨 Run 拼入的兼容 Attempt 与本次执行 Attempt 同等显示和计票；来源只在 Attempt 详情解释，不形成行状态或时效降级。
覆盖缺口渲染成占位行，不参与读数分母，并按 `never-run` / `previous-result` 解释是真没跑过还是存在旧但不兼容的结果；旧判定不补进当前报告。
两类缺口都附可直接复制的补跑命令。
实体 rows 由公开 `toExperimentRows(sample)` 产生；缺口原因从 Sample 直接投影。

locator 只打印 `@<id>` 与 verdict，不追加证据能力缩写。
Result 单元格使用 [Assertions 定义的主失败断言摘要](../../assertions/library/display.md#主失败断言怎样选)：passed attempt 固定为 `—`；failed attempt 只显示一条主失败及可选的 `+N more failures`；errored 显示结构化 error 的一层摘要。
绝不把该 attempt 的全部 assertion name 拼进表格——即使有几十条 assertions，一条 Attempt 子行也最多占两行。
locator 本身就是证据入口；打开 Attempt 后再列完整断言与实际可执行的证据命令。

Result 单元格一律按 [display 的单行压缩形态](../../assertions/library/display.md#单行压缩形态)拼装：先折成单行，再按宽度截断。
`received` 携带整段命令输出时也不例外；一条 `commandSucceeded()` 失败塌成 `received exit 1 · "…尾部"`，不会把几百行 stdout 逐行铺进表。
命令输出全量落盘（[证据 registry](../../record/architecture.md#证据-registry) 的 `commands` 行），单元格截断只是展示预算，不是存储上限。
单元格要的是能一眼扫读的预览：

```text
✗ 失败    memory/terminal-pypi-server
  ✗       └─ @1y0e4yh2                            commandSucceeded() · received exit 1 · "…test_api F · 1 failed, 0 passed"   4m 23s   $0.29
```

被折掉的完整 stdout 不丢：[`niceeval show @1y0e4yh2 --execution`](execution.md) 里那条命令的 result 卡片保留原始换行,`events.json` 存全量（超 256 KiB 才带 `truncated` 标记）。
表格从不为了「保全输出」而无限换行。

## 相关阅读

- [失败诊断首页](attempt.md) —— 从 locator 打开一次 attempt。
- [`--report` 的单页与多页](reports.md) —— 换掉这份默认报告。
- [Library · 内建报告](../library/built-in.md) —— 这份报告的定义本体。
