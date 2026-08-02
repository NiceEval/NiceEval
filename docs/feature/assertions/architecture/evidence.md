# Assertion 证据与完整性

作用域断言消费 Turn status、标准事件、派生事实和 usage；Sandbox 结果断言消费 agent 归因 diff 与文件；值断言消费显式值；judge 消费接收者默认材料或 `{ on }`。

断言可信度按证据覆盖三值折叠——覆盖声明的形状、Agent 级默认与 Turn 级降级见 [Adapter ·断言证据](../../adapters/architecture/evidence.md)：

- 所需通道 **complete**：正断言找到即通过、没找到 failed；负断言与上限断言正常判定。
- 所需通道 **partial / unavailable**：正断言找到匹配仍通过，因为存在的证据就是证据。Agent 构造时必须声明全部通道，不存在持久化的 unknown 状态。
  没找到时记 `outcome: "unavailable"`；「没采到」不能算成「Agent 没做」。
  负断言（`notCalledTool`、`usedNoTools`、`notEvent` 等）与上限断言（`maxTokens`、`maxCost`）一律 `unavailable`。
  空流证明不了「没发生」，缺 usage 不能按零聚合。
- unavailable 的判定折叠见 [Severity 与 Verdict](../../verdict/architecture.md)：非 `.optional()`断言评不了使 attempt `errored`。

Assertion collector 不从缺失数据推断“没有发生”，也不使用 OTel span 补写行为事件。

Sandbox 延迟断言在 attempt finalize 时读取结果；值 matcher 与 `require` 可以立即求值。
两种时机都记录统一 Assertion，不改变最终 Verdict 规则。

## 判定依赖与补充证据

证据采集是否能改变 Verdict，只由本 Attempt 已登记的消费者决定，不由 artifact 名、采集阶段或 provider 决定。

- 非 optional 的 Sandbox diff / 最终文件断言把对应通道登记为 **required**。采集失败时，该断言记 `unavailable`，并按上面的统一规则折成 `errored`。
- `.optional()` 断言仍登记自己消费的通道，但只形成 **optional** 依赖。证据缺席时保留 `unavailable` 记录，不改变 Verdict。
- 没有断言消费的 `diff.json`、trace 与其它报告材料属于 **supplemental**。采集失败只追加 `DiagnosticRecord`，不得制造空证据、不得覆盖已经形成的 AssertionResult 或 Verdict。
- 作者在普通 TypeScript 表达式里直接读取 `t.sandbox.diff` 后再把值交给 `t.check()` 时，读取动作本身登记 required。框架无法在任意值流里反推后续是否链 `.optional()`，需要可选语义时应使用带证据身份的 Sandbox 断言。

Runner 在采集前读取 collector 的证据需求快照。
同一通道同时存在 required 与 optional 消费者时按 required 处理；一次采集成功后，所有消费者与 artifact 共用同一份事实，不重复采集。
