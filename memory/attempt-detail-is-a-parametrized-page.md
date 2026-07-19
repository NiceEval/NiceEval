---
name: attempt-detail-is-a-parametrized-page
description: 裁决(2026-07-19)：attempt 详情从宿主固定路由内容翻案为报告里唯一的参数化 page，取代 reports-no-privilege-chrome-rulings 里"证据页归宿主路由"的部分
metadata:
  type: project
---

# 裁决

`plan/report-pages-attempt-detail-alignment.md` 落地时确认：attempt 详情不是宿主的固定路由内容，而是 `ReportDefinition.pages` 里唯一一种 `input: "attempt"` 的参数化 page——和 scope-input page 走同一条 `装载 → resolve → validate → render` 管线，区别只在输入判别与 `navigation: false`。一份报告至多声明一张。

三条具体结论：

1. **attempt 详情从"宿主固定路由内容"翻案为"报告中唯一的参数化 page"。** `show @<locator>` 与 view 的 locator URL 只是"选中这张 page + 传入 locator"的宿主寻址语法，不再是 host 自己拼装的内容（`attemptOverviewText` / `AttemptModal` 私有渲染）。宿主不再对"详情内容长什么样"有发言权，只负责寻址、装配 `AttemptEvidence` 并注入 page 的 resolve context。
2. **`ExperimentComparison` 与 `AttemptDetail` 都只是组合件（compose-only）。** 二者都用公开叶子组件装配，不拥有独立 `*Data` 类型、独立 renderer 或宿主特权；`AttemptDetail` 与其它任何自定义组合组件地位相同,用户可以直接从公开叶子重新拼装,不需要复制内部实现。
3. **无 attempt page 即无隐式 locator 目标。** 报告没有声明 `input: "attempt"` 的 page 时，locator 在 web/text 两面都只是普通文本；宿主不会因为"用户可能想看详情"就悄悄回退到内建详情或任何默认内容。要获得详情，报告必须显式声明该 page（自己写，或 `extends: standard` 继承内建的 `standardAttemptPage`）。

# 与既有裁决的关系

本条**取代** [[reports-no-privilege-chrome-rulings]] 第六条"深链不变量换保证方式：不再靠'证据页恒在 + 证据室不收窄'，改靠'attempt 详情路由对完整结果根解析、不占导航'"里"证据室是宿主路由内容"的隐含前提——那一条只翻案了"深链保证机制"（从"页恒在"换成"路由对全根解析"），并未处理"证据室的内容归属"；本条把内容归属也从宿主收回报告定义。`reports-no-privilege-chrome-rulings.md` 的历史正文不改写，仅在这里记录取代关系。

同批被取代的还有 `plan/reports-redesign-implementation.md` 第 48/51 条（"attempt 详情保持宿主路由，`show @<locator>` / `#/attempt/@<locator>` 对完整结果根解析、不随 Scope 收窄、不占导航"）——深链对全根解析这条结论仍然成立，但"内容由宿主路由持有"的部分被本裁决取代。`plan/view-attempt-detail-evidence-first.md`（`AttemptModal` 内部整改）与 `plan/attempt-evidence-feedback-loop.md`（要求宿主保留默认 Attempt 首页的部分）同样被取代，具体见 `plan/report-pages-attempt-detail-alignment.md` 第 12 节的取代标注。

# Why

用户 review 内建报告时的一贯诊断标准是"内建报告文件自己必须写得出来"（见 [[reports-no-privilege-chrome-rulings]] 的教训一节）：如果 attempt 详情只能通过宿主私有路由渲染、不能被一份 `defineReport` pages 数组表达，就说明 page 协议本身缺一种输入形态（`input: "attempt"`），该补协议而不是继续给宿主开小灶。

# How to apply

- 实现/重构报告相关代码时，任何"详情内容"逻辑都必须能表达成 `ReportPage` + 公开组件树；出现"宿主专属详情渲染函数"就是要撤走的旧模式。
- 自定义报告没有 attempt page 时，不要在 show/view 里悄悄补一张内建详情；按完整用户反馈报错，引导 `extends: standard` 或显式加 `standardAttemptPage`。
- 讨论"ExperimentComparison/AttemptDetail 要不要有自己的 data 类型"时，答案恒为否——它们是组合件，数据边界只在被组合的叶子组件上。
