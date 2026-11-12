---
relations:
  - role: supports
    target: docs/feature/inspection/README.md
  - role: supports
    target: docs/feature/experiments/architecture/cache.md
---

# CLI 摘要投影容易掩盖已保存的诊断

默认 Show 曾只读取 attempt.get 与 usage，遗漏 attempt.trace 已有的 diagnostics。
错误摘要看似没有落盘，实际只是读面没有选取对应的固定 operation。
判断历史证据缺失前，应先用公开 Query 读取负责该事实的切片，不能凭概览的空白推断 Record 不完整。

时间线把活动名称、阶段和多个长 ID 放入固定宽表格时，默认截断会同时抹去所有辨识信息。
管道适合按实际列内容确定宽度；交互终端应先去掉低信息 ID，失败活动另外用可折行的字段展示。
共享表格的 wrap 会把长词拆到多行，测试不能要求跨列折行的长词仍在 stdout 中连续出现。

identity manifest 的差异值是有界摘要。两侧结构化摘要可能都不是完整 JSON，甚至在真正变化前就已被截断成相同字符串。
给不同摘要计算展示用短哈希可以区分可见内容；相同摘要只能说明现有材料不足，不能证明身份相同。
这种哈希只属于 Human 呈现，不参与 execution identity、沿用资格或 manifest 落盘。
