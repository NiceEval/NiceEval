# `--history`:一道题时好时坏,按 attempt 看历次执行

## 解决什么问题

同一道 eval 这次绿、上次红,榜单只呈现当前 Scope 的汇总,回答不了「这道题历次跑下来发生了什么」。`--history` 给出逐 attempt 的执行时间轴:每次执行一行,失败原因、耗时、成本与 locator 都在行内,从时间轴上任意一次执行都能继续下钻取证([契约](../show/history.md))。

## 全流程

1. 用 eval id 前缀选中这道题,加 `--history`:

   ```text
   $ niceeval show memory/swelancer --history
   执行历史 · memory/swelancer 匹配 1 个 eval · 1 个 experiment

   ╭─ dev-e2b/codex-e2b · memory/swelancer-manager-proposals ───────────────────── 5 次执行 · 3 通过 2 失败 ─╮
   │ 2026-06-28 09:12  ✓ 通过  —                                                   2m 04s   $0.08  @160iuj3h │
   │ 2026-07-01 18:40  ✗ 失败  equals(4) · received 3                               50.0s   $0.05  @1qrdcfq8 │
   │ 2026-07-05 11:27  ✓ 通过  —                                                   2m 48s   $0.13  @1pcdj0az │
   │ 2026-07-08 22:03  ✗ 失败  commandSucceeded() · received exit 1 · "…1 failed"  2m 53s   $0.19  @13wrnsc4 │
   │ 2026-07-12 10:08  ✓ 通过  —                                                   2m 10s   $0.11  @1m3akx2d │
   ╰─────────────────────────────────────────────────────────────────────────────────────────────────────────╯
   ```

   对 Scope 中匹配的每个 `experimentId + evalId` 各成一个区域框,节内按 startedAt 升序列出历次 attempt,红绿交替一眼可辨;行尾 locator 就是下钻入口(分节、字段与去重规则见[契约](../show/history.md))。

2. 多个 experiment 都跑过这道题时,用 `--exp` 收窄到一条线再看时间轴,位置参数按裸前缀过滤、`--exp` 按 experiment id 路径段匹配,两个维度语义不混([契约](../show.md#选择结果范围)):

   ```bash
   niceeval show memory/swelancer --exp dev-e2b/codex-e2b --history
   ```

3. 从时间轴上挑出可疑的那次执行,复制它的 locator 下钻:

   ```bash
   niceeval show @1qrdcfq8
   ```

   接下来看断言、对话、时间树与 diff 的路径见 [`@locator` 下钻](show-locator-drilldown.md)。

4. 时好时坏的题通常要对照两次执行:对失败与通过的 locator 各开一次 `--execution` 或 `--diff`,比对 agent 行为差在哪一轮。

## 边界

- `--history` 与 `--report` 互斥:两者都占据主输出,`--history` 是宿主证据面的时间轴,不经报告树。
- 它逐 attempt 而非逐快照,且不设可比性门槛:改过 model / flags 后,榜单水位会把旧配置的结果挡在外面,时间轴上它们照常在轴。红绿分界正对配置改动时,看的不是 flaky 而是快照级趋势(成绩随配置版本变好还是变坏),不归它,用报告库的[历史配方](../library/recipes.md#历史一个实验的逐次快照走势);两个读数的分工见[契约](../show/history.md#与榜单水位的分工)。
- 前缀匹配不到任何有结果的 eval 时明确报无匹配并列出有结果的 eval,不做模糊猜测([契约](../show.md#无匹配与不可读结果))。

## 相关阅读

- [`--history`](../show/history.md) —— 分节、字段、区域框输出与榜单分工的单源契约。
- [`@locator` 下钻](show-locator-drilldown.md) —— 从时间轴上的一次执行继续取证。
- [Library · 配方](../library/recipes.md#历史一个实验的逐次快照走势) —— 快照级走势的报告写法。
