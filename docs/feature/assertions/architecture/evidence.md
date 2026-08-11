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

## 显式 value snapshot

`t.check(value, match)` 必须冻结已求值的 `value` 或它的安全结构化引用，不能只保存 Match 的
`matched` / `mismatched`。例如：

```ts
t.check(
  await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]),
  commandSucceeded(),
);
```

`await` 先取得 `CommandResult`，随后 `t.check` 把它作为 subject `a` 登记。这个 subject snapshot
至少保留：

| 数据 | 最小内容 |
|---|---|
| command identity | observation id、executable、args 与 cwd。 |
| execution result | exit code、signal 与 duration。 |
| streams | 脱敏 stdout / stderr，或指向它们的 evidence refs。 |
| evaluator | `commandSucceeded` identity、version 与完整安全 config。 |
| evaluation | matched、mismatched、unavailable 或 errored。 |
| limitations | stdout / stderr 的 redacted、truncated 或 unavailable 状态。 |

`commandSucceeded()` 评估时使用的 command identity、exit code、signal、duration 与 coverage 必须保留。
stdout / stderr 即使被截断，也不能让这些字段消失。未来读取面因此可以显示命令、退出状态与运行时间，
而不只显示“断言通过”。

## Scoped occurrence context

`calledTool(...)`、`loadedSkill(...)` 等 scoped Assertion 是 `check(a, b)` 的特例：方法从 scope 取得
normalized occurrences 作为 subject `a`，再用方法参数构造 evaluator `b`。它们必须保存 occurrence 的
安全结构化 context，不能只保存 true / false 或匹配数量。

| 数据 | 最小内容 |
|---|---|
| scope | Attempt、Session、Turn 或 vector-cut snapshot ref。 |
| occurrence identity | operation / event id 与对应 event refs。 |
| tool / skill context | name、脱敏 input、status、output 或 error refs、开始与结束事件。 |
| matching summary | observed count、matched count 与 matched occurrence refs。 |
| coverage | evaluator 检查的 evidence 通道是否完整。 |
| limitations | input、output 或事件证据的 redacted、truncated 或 unavailable 状态。 |

没有命中时仍保存 scope、coverage、observed count 与候选 occurrence refs。只有 evidence coverage 完整时，
“没有调用”才是 `mismatched`；evidence coverage 不完整时必须是 `unavailable`。

这些字段描述 NiceEval 归一化后的稳定 context，不要求保存 provider 私有对象或 secret。完整大型 output 可以
由 evidence ref 表达；Assertion 侧只规定必须保留什么信息，不规定 Record 怎样布置文件。

## 读取面

`show`、`view`、JSON、export 与 source 从同一份 evidence projection 解释结果。它们不重新读取 Sandbox、
调用 Judge 或重新执行 Match。
