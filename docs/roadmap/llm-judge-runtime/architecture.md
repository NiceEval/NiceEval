# 原生 LLM Judge Runtime —— 架构

LLM Judge 只读取声明的 Judge Material，不主动打开仓库、运行工具或补证据。Judge Check 负责选择 recipe、绑定材料和 profile；Runtime 负责校验静态图、调度、预算和重试；Provider 负责请求转换与响应归一。

最终 Decision 包含有限 `[0,1]` measurement、rationale 和脱敏 evidence 引用。无模型、无 key 或材料不可读时为 `unavailable`；无效响应、非有限数或区间外数为 `errored`。它们不会变成普通 mismatch 或 `0`。

Pass 或 Score 的差异只在 AssertionHandle projection。thresholded measurement 才能 `await .orStop()`。Record 保存 evaluator identity、版本、安全 config digest 与材料 ref，不保存 secret。

show、view、JSON 和 export 从 sealed AssertionResult 离线读取，不重新发送模型请求。
