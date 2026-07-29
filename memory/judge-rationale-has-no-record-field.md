# judge rationale 没有落盘字段,待裁决它的家

**现象**(2026-07-29):judge 断言的 `detail` 曾直接落成裁判模型的 rationale(spec 层没设
检查方式摘要,evaluate 返回 `detail: result.rationale`),show/view 的判定行标题因此显示
rationale 而不是 display.md 声明的 `closedQA("…")`。scoring 进度契约落地时给 spec.detail
补上了检查方式摘要,rationale 经 finalize 既有合并变成 `closedQA("…"); <rationale>`,
换一种方式继续污染标题。

**裁决**(2026-07-29):`detail` 按 `docs/feature/assertions/architecture.md` 只放检查方式
摘要,judge 的 evaluate 不再返回 rationale,rationale 暂不落盘。

**待裁决**:rationale(裁判对分数的解释)有真实排查价值——0.4 分是「跑题」还是「漏了一半
要求」只有它能说。但记录契约里没有它的家:`detail` 是摘要、`evidence` 是判分**输入**材料,
塞哪个都改变既有字段语义。要留它就得给 AssertionResult 增字段(如 `rationale`)并同步
architecture.md 与 display.md(view 折叠展示位),独立设计迭代做。
