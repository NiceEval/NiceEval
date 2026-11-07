# 随包 AI 文档 —— 效果评估

[随包 AI 文档](../README.md)是否真的帮到 coding agent，由独立评估仓库用 niceeval 自己给出证据。评估按 agent 所处的阶段分成两条链路：

| 阶段 | 页面 |
| --- | --- |
| 接入：只读 `INIT.zh.md` 与随包 `INDEX.md`，把 niceeval 接入真实项目 | [Agent Install Eval](agent-install-eval.md) |
| 诊断：接入之后，只靠随包文档与公开 CLI 从已发布的 Record 得到正确诊断 | [Agent Debug Eval](agent-debug-eval.md) |
