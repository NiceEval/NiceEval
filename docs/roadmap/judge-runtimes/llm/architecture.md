# 原生 LLM Judge Runtime —— 架构

LLM Judge 只读取 [MaterialBindingManifest](../material/architecture.md#materialbindingmanifest) 中的 presented blocks，不主动打开仓库、运行工具、请求证据网络或补充 Turn。Runtime 负责校验静态图、渲染 untrusted blocks、调度、token/cost/timeout 预算和重试；Provider 只负责请求转换与响应归一。

Recipe rubric、prompt rendering、Decision schema 与 measurement 语义由 NiceEval 的版本化 Judge protocol 拥有，
不委托第三方 scorer package。Provider adapter 不能带入自己的 rubric、默认模型、threshold 或分数映射；更换
provider 只改变 profile 所声明的执行身份。

Rubric、anchors、Decision protocol 与 provider system channel 是可信 control。材料和 definition reference 都进入分隔、版本化的 untrusted blocks；其中的 prompt injection 不能改写工具权限或系统协议。

最终 Decision 包含有限 `[0,1]` measurement、公开 rationale 和 evidence refs。无模型、无 key、预算无法保守证明或 required 材料不可用时为 `unavailable`；无效响应、非有限数、区间外数或伪造 evidence ref 为 `errored`。它们不会变成普通 mismatch 或 `0`。

Pass 或 Score 的差异只在 Grading Claim projection。Thresholded measurement 才能 `await .orStop()`。Record 保存 evaluator identity/version、manifest、rendering/security profile、batch provenance、Decision 与可见材料 digest，不保存 secret、隐藏思维链或 provider credential。

Batch 中 transport failure 可以使全批 unavailable；单项 response parse failure 只使该项 errored。Batch composition 和 protocol version 进入每项 Judge Evaluation identity；batch 不承诺 Decision 在统计上独立。

query 与 view 从 sealed AssertionResult 离线读取，不重新发送模型请求。
