# Assertions —— evidence

完整的 Assertion 与不可用语义见 [Assertions](../README.md)。本页只规定 evidence 如何进入同一条
`AssertionResult`。

## evidence 不是默认值

Assertion 读取的 snapshot、Judge material 和 evaluator 说明都属于 evidence。读取失败、传输失败或
资料不完整时，结果是 `unavailable` 或 `errored`，不能合成为普通 `mismatched`、`score: 0` 或空 evidence。

Usage Assertion 是唯一例外。只有 Agent 创建时已经声明 usage 不可用，`.ifCovered()` 才投影为
`notApplicable`。一旦开始采集，采集失败仍是 `unavailable`。

## 脱敏与引用

Record 保存足够解释 evaluation 的脱敏 evidence、evaluator explanation 与 Judge rationale。它保存
稳定引用，而不是把 secret、原始凭据或不安全配置写入 `AssertionResult`。

每个 `subjectSnapshotRef` 都能追到读取时的 sealed Observation。根 `t` scope 的引用必须表达 vector cut，
让离线读取面能说明它读到了哪些 Session 前缀。

## 读取面

`show`、`view`、JSON、export 与 source 从同一份 evidence projection 解释结果。它们不重新读取 Sandbox、
调用 Judge 或重新执行 Match。
