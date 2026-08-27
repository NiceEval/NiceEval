---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 审阅一次 Run 怎样采用结果

用户需要从 Experiment Overview 追到 exact Attempt，并以完整证据决定怎样采用该 Run 的结果。Insight 从同一份
完整 Snapshot 读取所有层级；它不会用详情 JSON 替代数据库，也不会向 Record 写入标记。

```sh
niceeval view --run <run-id>
```

读者在 Experiment → 可选 Eval 路径组 → Eval → Attempt table 中选择目标。Attempt member 保留 selected Run
identity，Run 本身不是独立层级。软导航把 Run 或 Attempt 详情放入 drawer/modal，同时保留 Overview、
Experiment selector 与语言。关闭详情或按 Back 会回到原表格；按 Forward 会恢复同一详情。

读者复制的 URL 是稳定深链接。在新标签或硬加载时，它显示完整 Run 或 Attempt 内容，不要求先打开
Overview，也不会显示没有背景的空 drawer。

Run debugger 显示该 Run 的身份、指标、判定、证据完整度与可比较关系。Attempt debugger 把 source 与 assertions、
trajectory、每次 tool input/output、timeline、usage、commands、diagnostics 和 diff 排成连续证据路径。读者可折叠
或展开 trajectory 与工具调用，并从 source 声明处查看对应 assertion 的输入、条件、观察值、权重与得分。

任一资料为 `partial`、`not-recorded` 或 `truncated` 时，对应区域显示状态、原因与已交付边界。Insight 不将
缺失事实填为成功，也不把读取限制伪装成完整结果。该路径只服务人的只读审阅与采用决定。
