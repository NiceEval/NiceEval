# 裸 `show`：默认报告的 text 面

裸 `niceeval show` 装载[内建报告](../library/built-in.md)，与显式渲染内置 `ExperimentComparison` 等价。Scope 命中多个可比组时，报告只输出组索引和可直接复制执行的 `niceeval show --experiment <group>` 命令；Scope 已经只剩一个组时，才输出该组的成本 × 端到端成功率散点图与 `ExperimentList`。experiment id 的父目录是组边界：`compare/*` 与 `dev-e2b/*` 不能共享坐标系、连线、排序或汇总数字；根目录 experiment 各自形成单例组。端到端成功率的分母包含 `failed` 与 `errored`，只有 `skipped` 不进入；因此执行错误会降低默认成功率，但仍在结果构成中单独显示，不与失败混成一种判定。单组只有一个可画 experiment 时也照常显示一个点，不要求至少两个实验。

可比组索引一行一个组，显示 experiment / eval 数、`GroupSummary` 的端到端成功率、Eval 最终 verdict 构成、成本与最后运行时间；成功率直接取官方 `endToEndPassRate` 格子，不从 verdict 计数重算。多组 Scope 到此结束，不把所有组的详情一次性倾倒到终端。单组 `ExperimentList` 保持实体层级：一个 experiment 下列 Eval，一个 Eval 下再列它的全部 Attempt。不能把组拍平，也不能把 Eval 与 Attempt 压平成一张“每行一个 Attempt、重复 Eval id”的表。Scope 只剩一个组时省略索引，直接进入该组。

```sh
$ niceeval show
WARNING  snapshot dev-e2b/codex-e2b @ 2026-07-12T10:08:29.361Z is unfinished;
         8 completed attempts are shown, but the snapshot may be incomplete.

实验组                  实验   Eval   端到端成功率   Eval 结果         预估成本   最后运行
compare                    2      6          75.0%   9 通过 / 3 失败      $1.42   2026-07-12 18:08
dev-e2b                    3      6          61.1%   11 通过 / 5 失败     $0.31   2026-07-12 18:09

查看组内详情：
  niceeval show --experiment compare
  niceeval show --experiment dev-e2b
```

```sh
$ niceeval show --experiment dev-e2b

实验组 dev-e2b

平均每个 eval 成本（越低越好） × 端到端成功率
... A

越靠右上越好
A dev-e2b/codex-e2b

实验                    模型            Agent   平均耗时   端到端成功率   结果               Tokens    预估成本
dev-e2b/codex-e2b      gpt-5.4-mini    codex   1m 58s    66.7%   4 通过 / 2 失败    198.9k    $0.17
6 道题 · 6 次 attempt · 2026-07-12T10:08:29.361Z

dev-e2b/codex-e2b
状态      题目 / Attempt                          结果                                      耗时      成本
✓ 通过    memory/agent-037-updatetag-cache
  ✓       └─ @160iuj3h                            —                                         2m 0s     $0.09
✓ 通过    memory/repomod-hello-world-api
  ✓       └─ @1sxmo0m1                            —                                         2m 58s    $0.57
✗ 失败    memory/swelancer-manager-proposals
  ✗       └─ @1qrdcfq8                            equals(4) · expected 4, received 3          50.0s     $0.05
✓ 通过    memory/terminal-cancel-async-tasks
  ✓       └─ @1pcdj0az                            —                                         2m 48s    $0.13
✗ 失败    memory/terminal-pypi-server
  ✗       └─ @13wrnsc4                            command exited 1 · commandSucceeded()      2m 53s    $0.19
✓ 通过    memory/tool-call-observability
  ✓       └─ @18etnsw5                            —                                         18.1s     $0.02
```

同一个 Eval 有重试时，只出现一个 Eval 标题，下面按 attempt 序号逐条列 locator、该 Attempt 自己的判定，以及耗时 / 成本或失败原因：

```text
✓ 通过    memory/flaky-retry
  ✗       ├─ @1first01                            expected ready, received pending            18.0s     $0.02
  ✓       └─ @1second2                            —                                           21.4s     $0.03
```

locator 只打印 `@<id>` 与 verdict，不追加证据能力缩写。Result 单元格使用 [Scoring 定义的主失败断言摘要](../../scoring/library/display.md#主失败断言怎样选)：passed attempt 固定为 `—`；failed attempt 只显示一条主失败及可选的 `+N more failures`；errored 显示结构化 error 的一层摘要。绝不把该 attempt 的全部 assertion name 拼进表格——即使有几十条 assertions，一条 Attempt 子行也最多占两行。locator 本身就是证据入口；打开 Attempt 后再列完整断言与实际可执行的证据命令。

Result 单元格的值一律按 [display 的两步压缩](../../scoring/library/display.md#契约一结果摘要)先折成单行、再按宽度截断，`received` 携带整段命令输出时也不例外：一条 `commandSucceeded()` 失败塌成 `exit 1 · "…尾部"`，而不是把几百行 stdout 逐行铺进表。落盘的 256 KiB 上限保护 artifact 体积，不替代这层单元格截断——单元格要的是能一眼扫读的预览：

```text
✗ 失败    memory/terminal-pypi-server
  ✗       └─ @1y0e4yh2                            commandSucceeded() · exit 1 · "…test_api F · 1 failed, 0 passed"   4m 23s   $0.29
```

被折掉的完整 stdout 不丢：[`niceeval show @1y0e4yh2 --execution`](execution.md) 里那条命令的 result 卡片保留原始换行,`events.json` 存全量（超 256 KiB 才带 `truncated` 标记）。表格从不为了「保全输出」而无限换行。

## 相关阅读

- [失败诊断首页](attempt.md) —— 从 locator 打开一次 attempt。
- [`--report` 的单页与多页](reports.md) —— 换掉这份默认榜单。
- [Library · 内建报告](../library/built-in.md) —— 这份榜单的定义本体。
