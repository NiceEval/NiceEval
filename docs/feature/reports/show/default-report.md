# 裸 `show`：默认报告的 text 面

裸 `niceeval show` 装载[内建报告](../library/built-in.md)并渲染其首页（报告页），尾部附 Attempts、追踪两页的索引。页首是 `Hero` 与 `ScopeWarnings`，随后 `ExperimentComparison` 直接输出当前 Scope 的摘要、成本 × 端到端通过率散点和 `ExperimentList`。整页组件树没有 `Section`，所以 text 面无框铺开——散点与宽表占满可用列宽；圆角面板只随 `Section` 出现（约定见 [Layout](../library/layout.md)），在 `AttemptDetail` 这类多区域详情页上。每个 experiment 的 eval 数与指标分母来自快照记录的 `selectedEvalIds`；未选择的 eval 不补成失败。实验列表保持 experiment → Eval → Attempt 层级。

Scope 内实验声明了 `labels: { line: … }` 时（下例每个实验声明了 `line` 与变体轴 `memory`），散点按线归类：

```sh
$ niceeval show --exp memory
Eval 运行结果
最后运行 2026-07-12 18:08 · 由 5 份快照合成

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
bub      A memory/bub
claude   B memory/claude-baseline → C memory/claude-mempal
         └ 通过率 +25pt · 成本 +$0.20
codex    D memory/codex-baseline → E memory/codex-mempal
         └ 通过率 +37.5pt · 成本 +$0.13

实验                       模型      Agent    平均耗时   通过率   结果               Tokens    成本
memory/bub                gpt-5.4   bub      1m 12s    87.5%   7 通过 · 1 失败    112.4k    $0.72
memory/claude-mempal      gpt-5.4   claude   2m 41s    75.0%   6 通过 · 2 失败    301.2k    $4.40
memory/codex-mempal       gpt-5.4   codex    2m 05s    62.5%   5 通过 · 3 失败    201.7k    $2.32
memory/claude-baseline    gpt-5.4   claude   1m 58s    50.0%   4 通过 · 4 失败    188.0k    $2.80
memory/codex-baseline     gpt-5.4   codex    1m 21s    25.0%   2 通过 · 6 失败    129.3k    $1.28

其余页：
  attempts   Attempts   niceeval show --exp memory --page attempts
  traces     追踪       niceeval show --exp memory --page traces
```

表下逐实验的 Eval / Attempt 层级与下面 dev-e2b 例一致，不重复。散点 x 轴是**平均每个 eval 成本**（表中成本列是实验总成本，除以题数得每题均值），`better: "lower"` 反向渲染——越右越省；标记字母按图例顺序分配：series 按显示键字典序（bub < claude < codex），series 内按 x 原始值升序，所以 claude 线是 B（baseline，$0.35/题）→ C（mempal，$0.55/题）。位移摘要的符号是原始差值：`成本 +$0.20` 表示每题贵了 $0.20，方向好坏由指标的 `better` 语义判断，摘要不替读者下结论。

Scope 内没有任何 `line` 声明时按 agent 归类、不连线，图例行首是 agent 名：

```sh
$ niceeval show --exp dev-e2b
Eval 运行结果
最后运行 2026-07-12 18:09 · 由 3 份快照合成

平均每个 eval 成本（越低越好） × 端到端通过率 · 按 agent 归类
 100% ┤
      │
      │              A
  50% ┤
      │
      └──────────┬──────────┬
               $0.04      $0.00

越靠右上越好
codex   A dev-e2b/codex-e2b

实验                    模型            Agent   平均耗时   通过率   结果               Tokens    成本
dev-e2b/codex-e2b      gpt-5.4-mini    codex   1m 58s    66.7%   4 通过 · 2 失败    198.9k    $0.17
6/7 个 Eval · 6 次 attempt · ↩ 1/6 attempts · 2026-07-12T10:08:29.361Z

dev-e2b/codex-e2b
状态      题目 / Attempt                          结果                                                耗时      成本
✓ 通过    memory/agent-037-updatetag-cache
  ✓       └─ @160iuj3h                            —                                                   2m 0s     $0.09
✓ 通过    memory/repomod-hello-world-api
  ✓       └─ @1sxmo0m1                            —                                                   2m 58s    $0.57
✗ 失败    memory/swelancer-manager-proposals
  ✗       └─ @1qrdcfq8                            equals(4) · received 3                              50.0s     $0.05
✓ 通过    memory/terminal-cancel-async-tasks   ↩ 2d
  ✓       └─ @1pcdj0az   ↩ 2d                     —                                                   2m 48s    $0.13
✗ 失败    memory/terminal-pypi-server
  ✗       └─ @13wrnsc4                            commandSucceeded() · received exit 1 · "…1 failed"  2m 53s    $0.19
✓ 通过    memory/tool-call-observability
  ✓       └─ @18etnsw5                            —                                                   18.1s     $0.02
—         memory/uv-lock-refresh                  当前配置下无结果 · niceeval exp dev-e2b/codex-e2b

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

携带或跨快照拼入的历史执行在题目名 / locator 后带 `↩ <时距>` 时效标注，Experiment 副行汇总 `↩ n/m attempts`；覆盖缺口渲染成「当前配置下无结果」占位行并附补跑命令，不参与指标分母（两条契约见 [ExperimentList](../library/entity-lists.md#experimentlist) 与[时效标注](../library/entity-lists.md#时效标注)）。

locator 只打印 `@<id>` 与 verdict，不追加证据能力缩写。Result 单元格使用 [Scoring 定义的主失败断言摘要](../../scoring/library/display.md#主失败断言怎样选)：passed attempt 固定为 `—`；failed attempt 只显示一条主失败及可选的 `+N more failures`；errored 显示结构化 error 的一层摘要。绝不把该 attempt 的全部 assertion name 拼进表格——即使有几十条 assertions，一条 Attempt 子行也最多占两行。locator 本身就是证据入口；打开 Attempt 后再列完整断言与实际可执行的证据命令。

Result 单元格的值一律按 [display 的单行压缩形态](../../scoring/library/display.md#单行压缩形态)拼装：先折成单行、再按宽度截断，`received` 携带整段命令输出时也不例外——一条 `commandSucceeded()` 失败塌成 `received exit 1 · "…尾部"`，而不是把几百行 stdout 逐行铺进表。落盘的 256 KiB 上限保护 artifact 体积，不替代这层单元格截断——单元格要的是能一眼扫读的预览：

```text
✗ 失败    memory/terminal-pypi-server
  ✗       └─ @1y0e4yh2                            commandSucceeded() · received exit 1 · "…test_api F · 1 failed, 0 passed"   4m 23s   $0.29
```

被折掉的完整 stdout 不丢：[`niceeval show @1y0e4yh2 --execution`](execution.md) 里那条命令的 result 卡片保留原始换行,`events.json` 存全量（超 256 KiB 才带 `truncated` 标记）。表格从不为了「保全输出」而无限换行。

## 相关阅读

- [失败诊断首页](attempt.md) —— 从 locator 打开一次 attempt。
- [`--report` 的单页与多页](reports.md) —— 换掉这份默认榜单。
- [Library · 内建报告](../library/built-in.md) —— 这份榜单的定义本体。
