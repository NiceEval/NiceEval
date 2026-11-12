---
relations:
  - role: supports
    target: docs/feature/inspection/README.md
---

# Judge rationale 读取要识别独立材料状态

人读输出缺少 Judge 理由时，先用公开 `attempt.assertion.detail` 区分呈现遗漏与真正未保存，不能直接推断持久化缺字段。

2026-11 的下游调查发现，`entry.explanationRetention` 已保存理由。其 `rationale` 是含 `state` 和 `value` 的嵌套事实，不是直接字符串。只读取字符串的 renderer 会漏掉它；递归收集所有 `reason` 又会把相邻 citations 的 `not-recorded` 误标成理由。

呈现时按材料自己的状态读取内容，保留 rationale 与 citations 的独立可用性。终端自动换行后，验证完整内容需要忽略呈现增加的空白，不能把未折行的 query 字符串直接作为 stdout 子串。

早期把 rationale 当作展示标题的做法会污染检查标签。标题与判分理由仍应分别呈现，公开契约见 [Assertions](../docs/feature/assertions/README.md)。
