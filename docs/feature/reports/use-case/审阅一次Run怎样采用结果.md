---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 审阅一次 Run 的闭合结果

用户需要确认一条 sealed Run 的层级、判定、完整度、Evidence 与可继续查看的 exact Attempt。

```sh
niceeval view --run <run-id>
```

命令打开固定 Run overview，用户再从页面内的 Run/Attempt 导航进入 exact Attempt detail。CLI 不接受 positional
Attempt locator；locator 仍是该 Attempt 的数据 identity。

View 只显示 operation 已关闭的 selection、denominator、partial、missing、issues 与 Evidence。它不能通过显示过滤把缺口伪装为完整。

Attempt detail 是固定第一方页面中的连续详情。它先给出身份、Verdict、Score、coverage 与 limitation，再把同一 Attempt 的源码、
断言证据、session log、工具调用、执行时序、diagnostics 与文件变更组成一条可追踪的路径。

源码按行显示，并在对应声明位置展开断言的输入、条件、观察值、权重与得分。session log 按 Turn 与事件顺序呈现 user、assistant、
context、tool、subagent 与 error。

读者可以搜索事件，折叠 Turn 或工具调用，并在同一工具 occurrence 中查看输入、输出与结果。

View 不用原始 JSON 表格代替这些调试关系。任一 Inspection 分段为 `partial`、`not-recorded`、`invalid` 或 `truncated` 时，对应区域保留该状态、原因、已交付边界与固定的继续读取方式。

自动化需要相同事实时使用 `niceeval query`，而不是从 View 获取机器数据。
