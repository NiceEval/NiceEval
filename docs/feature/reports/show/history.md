# `--history`：一个 eval 的执行时间轴

`niceeval show <eval 前缀> --history` 回答「这道题历次跑下来发生了什么」。榜单只呈现当前 Scope 的汇总水位；`--history` 把匹配的 eval 摊开成逐 attempt 的执行时间轴，从时间轴上任意一次执行都能继续下钻取证。

## 分节与行内字段

Scope 中匹配的每个 `experimentId + evalId` 组合各成一节，分节按 experimentId、evalId 排序依次堆叠。节内是跨快照按 [attempt 身份键](../../results/library.md#身份键与去重)去重后的历次 attempt，按 startedAt 升序，一次执行一行，行内字段依次为：开始时间、verdict、单行结果摘要（主失败断言或结构化 error 的一层摘要，与榜单同一[单行压缩形态](../../scoring/library/display.md#单行压缩形态)）、耗时、成本与 locator。locator 固定收尾：它是从这一行继续下钻的入口，贴在行尾最容易整段复制。

## 输出

时间轴是有边界、可整体阅读的面板，每节按[区域框](../library/layout.md#区域框text-面的框线体裁)渲染：`experimentId · evalId` 嵌上边框左侧，执行数与通过 / 失败计数嵌上边框右侧；框外页首一行汇总 Scope 命中的范围。

```text
$ niceeval show memory/swelancer --history
执行历史 · memory/swelancer 匹配 1 个 eval · 2 个 experiment

╭─ dev-e2b/codex-e2b · memory/swelancer-manager-proposals ───────────────────── 5 次执行 · 3 通过 2 失败 ─╮
│ 2026-06-28 09:12  ✓ 通过  —                                                   2m 04s   $0.08  @160iuj3h │
│ 2026-07-01 18:40  ✗ 失败  equals(4) · received 3                               50.0s   $0.05  @1qrdcfq8 │
│ 2026-07-05 11:27  ✓ 通过  —                                                   2m 48s   $0.13  @1pcdj0az │
│ 2026-07-08 22:03  ✗ 失败  commandSucceeded() · received exit 1 · "…1 failed"  2m 53s   $0.19  @13wrnsc4 │
│ 2026-07-12 10:08  ✓ 通过  —                                                   2m 10s   $0.11  @1m3akx2d │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────╯

╭─ dev-e2b/claude-e2b · memory/swelancer-manager-proposals ──────────────────── 2 次执行 · 2 通过 0 失败 ─╮
│ 2026-07-02 15:31  ✓ 通过  —                                                   3m 05s   $0.44  @1w7kqe2f │
│ 2026-07-12 10:21  ✓ 通过  —                                                   2m 41s   $0.37  @1hv93mdz │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

结果摘要列与榜单同一口径：passed 固定为 `—`，failed 只显示主失败断言的单行压缩，errored 显示结构化 error 的一层摘要；超宽先折单行再按列宽截断，绝不逐行铺开命令输出。时间轴上任意一行都可下钻：复制行尾 locator，`niceeval show @1qrdcfq8` 打开这次执行的诊断首页，继续看断言、对话、时间树与 diff（[失败诊断首页](attempt.md)）。

## 与榜单水位的分工

榜单聚合走 `current()` 的[可比性前提](../../results/library.md#官方现刻水位resultscurrent)：改过 model、flags 或 sandbox 后，旧配置快照覆盖的题不再拼入当前水位，只以覆盖占位行提示补跑。`--history` 站在这层过滤之外——时间轴不设可比性门槛，旧配置下的执行同样按时间在轴上。两个读数配合区分「时好时坏」的两种病因：红绿交替发生在同一套配置内，是 agent 行为不稳定，下钻对比失败与通过的两次执行；红绿分界正对配置改动，是快照级趋势，不归 `--history`，用报告库的[历史配方](../library/recipes.md#历史一个实验的逐次快照走势)。

## 边界

- 与 `--report` 互斥：两者都占据主输出，`--history` 是宿主证据面的时间轴，直接读取 Results evidence 做终端投影，不经报告树；报告组件（如 `Grid` 的直角数据格）对它不适用。
- 前缀匹配不到任何有结果的 eval 时明确报无匹配并列出有结果的 eval，不做模糊猜测（[契约](../show.md#无匹配与不可读结果)）。

## 相关阅读

- [裸 `show` 的默认报告](default-report.md) —— 榜单水位与 Result 摘要口径。
- [失败诊断首页](attempt.md) —— 从时间轴一行的 locator 打开一次 attempt。
- [Library · 布局](../library/layout.md#区域框text-面的框线体裁) —— 区域框的单源体裁。
- [用例 · 时好时坏](../use-case/show-history-flaky-eval.md) —— 排查 flaky eval 的全流程叙事。
