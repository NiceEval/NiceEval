# 评分证据与完整性

作用域断言消费 Turn status、标准事件、派生事实和 usage；Sandbox 结果断言消费 agent 归因 diff 与文件；值断言消费显式值；judge 消费接收者默认材料或 `{ on }`。

断言可信度按证据覆盖三值折叠——覆盖声明的形状、Agent 级默认与 Turn 级降级见 [Adapter · 断言证据](../../adapters/architecture/evidence.md)：

- 所需通道 **complete**：正断言找到即通过、没找到 failed；负断言与上限断言正常判定。
- 所需通道 **partial / unavailable / unknown**（Adapter 未声明按 unknown）：正断言找到匹配仍通过——证据存在就是证据；没找到记 `outcome: "unavailable"`，「没采到」不能算成「Agent 没做」；负断言（`notCalledTool`、`usedNoTools`、`notEvent` 等）与上限断言（`maxTokens`、`maxCost`）一律 `unavailable`——空流证明不了「没发生」，缺 usage 不能按零聚合。
- unavailable 的判定折叠见 [Severity 与 Verdict](severity-and-verdict.md)：非 `.optional()` 断言评不了使 attempt `errored`。

Scoring 不从缺失数据推断“没有发生”，也不使用 OTel span 补写行为事件。

Sandbox 延迟断言在 attempt finalize 时读取结果；值 matcher 与 `require` 可以立即求值。两种时机都记录统一 Assertion，不改变最终 Verdict 规则。
