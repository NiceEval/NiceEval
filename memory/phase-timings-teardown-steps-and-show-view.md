---
format: concord.document/v1
id: phase-timings-teardown-steps-and-show-view
title: 设计裁决:阶段计时补收尾段与钩子步级明细,消费面扩到 show/view
createdAt: 2026-07-14T05:37:46Z
createdAtSource:
  kind: first-recorded
  path: memory/phase-timings-teardown-steps-and-show-view.md
  commit: 2133aff71498fdd259b04e29ca6eedf1610b2804
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---
# 设计裁决:阶段计时补收尾段与钩子步级明细,消费面扩到 show/view

**裁决**(2026-07-14,用户以「sandbox eval 要能 debug:沙箱启动时间、setup 下面每条的时间、各生命周期的执行与用时,并在 show 和 view 里展示」为准绳发起的契约挑战):

1. **收尾段计时落盘**:`PhaseName` 闭集新增 `agent.teardown` / `sandbox.teardown` / `sandbox.stop`。收尾段无论主链成败都执行并计时,每条可独立标 `failed`(对应 teardown diagnostic,不改判定);`durationMs` 口径不变(仍不含收尾),∑ 主链 phases ≤ `durationMs`,收尾条目在口径之外单独可读。
2. **钩子链步级明细**:`PhaseTiming` 新增可选 `steps`(`{label, durationMs, failed?}`)。`sandbox.setup` / `sandbox.teardown` 的 phase 级仍合计一条(跨实验聚合口径不变),`steps` 按链序逐钩子——具名函数用函数名,匿名钩子用 `setup#<i>` / `teardown#<i>`;label 不是稳定身份,只供单 attempt debug,不做跨实验聚合。`agent.setup` 不带 steps(adapter 内部,runner 看不见步骤边界),归 `docs/roadmap/scoped-attempt-feedback.md` 提案。
3. **消费面扩到 show/view**:show attempt 首页新增 `timing:` 阶段摘要行,新增 `--timing` 证据切面(逐阶段表 + steps + 失败标记 + 收尾分组);view Attempt 详情新增阶段耗时区(主链分解条 + 收尾列表,钩子行可展开)。阶段计时仍不进 OTel trace / Traces 瀑布。

**曾选方案(被本裁决改写的三条原契约)**:

- 「口径与 `durationMs` 对齐,teardown 不计」——收尾完全不计时(`docs/engineering/benchmark/README.md` 原语义规则)。
- 「`sandbox.setup` 钩子链合计一条……钩子内部需要细分时自己 `log()`」——无任何步级落盘。
- 「`niceeval show`、`niceeval view` 与 Reports 不提供阶段分段视图;本工程机制的消费面是结果读取 API 与 `bench/`」。

**否决理由**:

- teardown 不计时让「判定早已确定、进程还在等收尾」(teardown 钩子回存状态慢、provider stop 卡住)完全不可归因;`result.json` 本就在 teardown 与 stop 之后封口,计时可行且零额外窗口。保留的部分:`durationMs` 口径不动,收尾不进跨实验耗时对比。
- 钩子链合计一条的原理由(匿名代码无稳定标识、跨实验不可比)只针对**聚合**成立,不构成「单 attempt debug 也不给数据」的理由;`log()` 不落盘,事后无从回看。phase 级合计保留了原裁决的核心,step 级只回答「这一次的 setup 慢在链上哪一环」。
- 「show/view 不提供阶段视图」让普通用户 debug 无门(只剩手读 JSON 或写脚本),且与既有契约已经自相矛盾:`docs/feature/experiments/cli.md` 承诺 errored 首页「展开发生过的阶段」,`docs-site/zh/guides/viewing-results.mdx` 说 `result.json` 含「正式阶段耗时」——数据落了盘却没有官方展示面。
- 覆盖核对:「沙箱启动时间」原契约已覆盖(`sandbox.create`,且 `sandbox.queue` 单列防并发污染),本轮未改动。

**How to apply**:实现按 `plan/sandbox-phase-timing-surfacing.md` 执行。契约落点:`docs/feature/results/architecture.md`(类型)、`docs/engineering/benchmark/README.md`(语义与守护)、`docs/feature/reports/show.md`(`--timing`)、`docs/feature/reports/view.md`(Attempt 详情)。不要顺手实现 `agent.setup` 内部明细——那是 scoped-attempt-feedback 提案明确推迟的范围(见 `attempt-phase-scoped-feedback-api-deferred`)。
