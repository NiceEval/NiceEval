# Assertions —— 证据与完整性

Fact producer 负责说明自己需要的证据。scope Fact 读取 Turn status、标准 events、派生事实和 usage；Sandbox Fact 读取最终 diff 或文件；值 Fact 读取显式值；Judge Fact 读取作者给出的文本材料。

完整证据可以产生 `passed` 或 `failed`。partial 或 unavailable 证据仍可证明已经出现的正向事实，但不能把缺少的事件、工具调用或 usage 当成不存在。无法完成判分时，Fact 产出 `unavailable` 和结构化 reason。

`unavailable` 是否影响 Attempt 由 use 决定。普通 verdict use 和 score use 都如实消费它；只有核心 `assertIfCovered` 能在 Agent 创建时已声明 usage 不可用的狭窄场景产生 `notApplicable`。

没有 Fact use 的 artifact、trace 或报告材料是补充证据。采集失败只写入 diagnostic，不能回填假的 Fact、分数或 verdict。

Sandbox 文件 Fact 在被消费时读取。`require` 只能消费即时 Fact；它不会把最终 diff 或文件读取提前到不稳定的中间状态。
