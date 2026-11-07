# Eval 父行重复 Attempt 失败内容

**现象（2026-07-15）**：默认 `niceeval view` 的 `ExperimentList` 展开区会在失败 Eval 父行显示一条主失败摘要，紧接着又在唯一 Attempt 子行显示完全相同的摘要。`EvalList` web 面有同类问题。单 Attempt 时信息逐字重复；多 Attempt 时父行只能任意挑一轮的原因，却没有标明它不是 Eval 级事实。

**根因**：数据层给 `ExperimentListEvalRow` / `EvalListItem` 计算了 `reason`，web renderer 直接放进父行。父行同一位置还在 passed 时改放平均耗时和成本，使布局字段含义随 verdict 改变。text 面已经把失败摘要留在 Attempt 子行，没有这层重复，两个渲染面因此也不一致。

**修法**：Eval 父行固定承载折叠判定、Attempt 数和题级聚合（平均耗时、平均成本）；失败断言或结构化错误摘要只由 `AttemptListItem` 在 Attempt 子行渲染。删除 Eval 数据项上的 `reason`，避免自定义渲染继续把某一轮摘要误当成题级事实；同时让平均值标签经 report locale 字典渲染，缺数据保持明确空值。

**护栏**：Reports 双面测试用单个 failed / errored Attempt 断言展开树中的摘要只出现一次，并断言 failed Eval 父行仍显示平均耗时与平均成本。测试见 `src/report/dual-render.test.tsx`。
