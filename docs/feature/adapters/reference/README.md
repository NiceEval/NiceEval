# Adapter 参考调研

这里保存外部协议、SDK 与可观测生态的源码阅读和调研笔记，为 Adapter 设计裁决提供证据。
它们不是 niceeval 的公共契约，也不是普通用户的必读路径。

| 调研 | 内容 |
|---|---|
| [agent-eval](agent-eval.md) | Claude Code / Codex 的采集与转换实现 |
| [Agent loop APIs](agent-loop-apis.md) | Claude Agent SDK、LangGraph、pi 等原生接入面 |
| [Claude Code OTel](claude-code-otel-telemetry.md) | Claude Code 自带遥测的字段和限制 |
| [eve protocol](eve-protocol.md) | 原生 eval runtime 事件协议 |
| [OTel GenAI](otel-genai.md) | GenAI semantic conventions 与相关生态 |
| [OTel instrumentation](otel-instrumentation.md) | 现成框架埋点的数据完整性 |

已采纳的产品判定必须写回 [`../architecture.md`](../architecture.md) 或对应 [`../sdk/`](../sdk/README.md) 页面；研究页不替代目标契约。
