---
name: attempt-facts-table-replaces-text-splice-hack
description: show 详情新增 facts 完整键值表组件(AttemptFacts/TaskFactsResultView),取代 2026-07-23 遗留的 insertFactsLine 字符串级单行拼接 hack;exp 收尾 FAILURES 面板新增 facts 摘要提示
metadata:
  type: project
---

**裁决**(2026-08-04):`AttemptRecord.facts`(`ctx.fact()` 上报的运行事实)在 show 详情渲染为完整键值表,而不是压成一行摘要——facts 是开放键集合(一次运行零到几十个键),压缩会丢内容。新增 `attemptFactsData(evidence)`(`src/report/components/attempt-detail/compute.ts`)+ `toAttemptFacts`(`src/report/model/conversions.ts`),两条消费路径各自接线:内建 `standard` 报告的 `AttemptDetailsResultView`(`src/report/built-in/result-components.tsx` 的 `TaskFactsResultView`)与公开可复用组件 `AttemptDetails`(`src/report/components/attempt-detail/index.tsx` 的私有 `AttemptFacts`)。`AttemptDetailsResult`(`src/report/tasks.ts`)新增 `facts` 字段,`--json` 随之带出。exp 收尾 `FAILURES` 面板不展开,只在失败 attempt 有 facts 时于身份行/组行尾追加一次 `facts ×N`(N=键数,`src/runner/feedback/human.ts` 的 `factsHint`),完整键值表仍留给 `niceeval show @<locator>`。

**踩坑(意外发现)**:动手前搜索 `src/show/render.ts`、`src/report/components/attempt-detail/**` 均未发现任何 facts 渲染代码,误判"facts 展示完全未实现"。实际 `src/show/index.ts` 的 `insertFactsLine`(2026-07-23 提交,`show-scope-slice-json-ruling` 同批)已经在裸 `show @<locator>`(无 `--report` 或走自定义报告 attempt page)渲染出 `facts: k=v · k=v` 单行,拼接位置在 `usage:` 行之后——它是一条**字符串级别的文本拼接**,故意不碰 `src/report/**`(注释原文:「facts 不是报告组件的公开面」),显然是当时为了不跨自己范围而选的临时方案。新增组件化实现后二者同时触发,`show @<locator>` 一度把同一份 facts 展示两遍(表格 + 单行)。修法是删除 `insertFactsLine` 函数与调用点,只保留组件化的完整键值表。

**教训**:仅靠 grep `src/report/**` 和 `src/show/render.ts` 不足以断定某个 show 渲染能力"完全没做"——`src/show/index.ts`(CLI 编排层)可能绕过组件树直接做字符串后处理。下次评估某个 show 输出是否已实现,要连 `src/show/index.ts` 一起搜,尤其是搜目标 CLI 输出的关键字(如本例的 `"facts: "`)而不是只搜类型名或组件名。

**实现落点**:`src/report/components/attempt-detail/compute.ts`(`attemptFactsData`)、`src/report/model/types.ts`(`AttemptFactsData`)、`src/report/model/conversions.ts`(`toAttemptFacts`)、`src/report/components/attempt-detail/index.tsx` 与 `src/report/built-in/result-components.tsx`(两条渲染路径)、`src/report/tasks.ts`(`AttemptDetailsResult.facts`)、`src/show/index.ts`(删除 `insertFactsLine`)、`src/runner/feedback/failure.ts`(`FailureDetail.factsCount`)、`src/runner/feedback/human.ts`(`factsHint`)。契约见 `docs/feature/reports/show/attempt.md`「Facts」、`docs/feature/reports/components/attempt-detail/attempt-facts.md`(新文档)、`docs/feature/experiments/cli.md`「人看的结束反馈」。
