# 执行轨迹的应用展示 —— Design Decision

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

`niceeval show @<locator> --execution` 和 View 的 Attempt debugger 对 Agent 有专用投影：用户消息、助手回答、工具调用和命令都按语义呈现。
自定义应用经 [`recordTrace`](../../feature/adapters/library/README.md#保存通用执行轨迹) 交付的领域事件只能显示 `type`、`actor`、
512 字节 `summary` 和原始 JSON。游戏里 NPC 说的一段话、HTTP 应用的一次请求、生图应用的一张图，都没有可读形式。

本决策比较“把应用事件转换成人读展示”这一步放在哪里执行：Adapter 写入时把展示随事件封存，还是读取时调用 Adapter 提供的 formatter。
两者都保持 Agent 现有的 Conversation 与 Commands 呈现，只给通用轨迹补人读形式；区别在历史可读性、读取侧是否执行作者代码，以及与
[CLI Insight 裁决](../cli-insight/DECISION.md)的关系，因此摊开比较。

外部用户自建 benchmark 网页的接入面属于 [Benchmark Web 消费](../benchmark-web-consumption/README.md)，不在本决策范围。

<!-- concord.design-index/v1:start -->
## 候选方案索引（生成）

- [plan-1（已选择）](plans/plan-1/README.md)
- [plan-2](plans/plan-2/README.md)

裁决：[plan-1](plans/plan-1/README.md)。
<!-- concord.design-index/v1:end -->
