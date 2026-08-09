# Assertion 证据与完整性

作用域断言消费 Turn status、标准事件与派生 Observation；usage、diff、trace 等经固定 GraphRef 的 Projector 读取。Sandbox 结果断言消费 agent 归因 diff Projection 与文件；值断言消费显式值；Judge 消费接收者默认材料或 `{ on }`。

断言可信度按证据完整度三值折叠——完整度声明的形状、Agent 级默认与 Turn 级降级见 [Adapter ·断言证据](../../adapters/architecture/evidence.md)：

- 所需通道 **complete**：正断言找到即通过、没找到 failed；负断言与上限断言正常判定。
- 所需通道 **partial / unavailable**：正断言找到匹配仍通过，因为存在的证据就是证据。Agent 构造时必须声明全部通道，不存在持久化的 unknown 状态。
  没找到时记 `outcome: "unavailable"`；「没采到」不能算成「Agent 没做」。
  负断言（`notCalledTool`、`usedNoTools`、`notEvent` 等）与上限断言（`maxTokens`、`maxCost`）一律 `unavailable`。
  空流证明不了「没发生」，缺 usage 不能按零聚合。
- unavailable 的判定折叠见 [Severity 与 Verdict](../../verdict/architecture.md)：非 `.optional()`断言评不了会形成 `errored` Verdict Claim；它不改变 Attempt lifecycle。

Assertion collector 不从缺失数据推断“没有发生”，也不使用 OTel span 补写行为事件。

Sandbox 延迟断言在 Attempt finalize 时读取固定 revision 的读面；值 matcher 与 `require` 可以立即求值。
两种时机都形成统一 Assertion Claim，不改变最终 Verdict Claim 规则。

## 判定依赖与补充证据

证据采集是否能改变 Verdict Claim，只由本 Attempt 已登记的消费者决定，不由 artifact 名、采集阶段或 provider 决定。

- 非 optional 的 Sandbox diff 断言把 diff 通道登记为 **required**。采集失败时，该断言形成 unavailable Assertion Claim，并按上面的统一规则形成 `errored` Verdict Claim。
- `.optional()` 断言仍登记自己消费的通道，但只形成 **optional** 依赖。证据缺席时保留 unavailable Assertion Claim，不改变 Verdict Claim。
- 没有断言消费的 diff、trace 与其它报告读面属于 **supplemental**。采集失败只追加 Diagnostic Observation，不得制造空证据、不得替换已经形成的 Assertion Claim 或 Verdict Claim；不存在 `diff.json` 这类私有事实真源。
- 作者在普通 TypeScript 表达式里直接读取 `t.sandbox.diff` 后再把值交给 `t.check()` 时，读取动作本身登记 required。框架无法在任意值流里反推后续是否链 `.optional()`，需要可选语义时应使用带证据身份的 Sandbox 断言。

Runner 在采集前读取 collector 的证据需求快照。
同一通道同时存在 required 与 optional 消费者时按 required 处理；一次采集成功后，所有消费者与 artifact 共用同一份事实，不重复采集。
