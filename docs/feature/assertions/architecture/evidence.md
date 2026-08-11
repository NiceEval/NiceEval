# Assertions —— evidence

完整的 Assertion 与不可用语义见 [Assertions](../README.md)。本页只规定 evidence 如何进入同一条
`AssertionResult`。

## 三个不同问题

channel descriptor 的 `collection` 先说明 payload 是 `present` 还是 `absent`；present 再说明采集集合是 complete 还是带 reason 的 partial。reader 的 `ChannelProjectionResult` 另行说明本次解码是 complete、partial、unsupported 还是 invalid。payload 自己还可以声明 sampled、redacted、truncated 等语义 limitation。

三者不能合并：

- 已采集的 JSONL 可能因未知 event 只得到 partial 解码。
- 未采集和不适用由 descriptor `absent(reason)` 形成 `unavailable`，不是空数组。
- 读取到损坏或缺失 channel 文件是 `invalid`。
- 旧 reader 不支持某个 channel 是 `unsupported`。
- collection/decoding complete 不能抹掉 payload 的 sampled/redacted limitation。

`AssertionResult` 保留足够解释 evaluation 的脱敏 evidence、evaluator explanation 与 Judge rationale，
并使用稳定引用，而不是携带 secret、原始凭据或不安全配置。

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

- [Assertions 架构](../architecture.md)
- [Record Library · ChannelProjectionResult](../../record/library.md#channelprojectionresult)
- [Verdict 规则](../../verdict/architecture.md)
- [Adapter 证据](../../adapters/architecture/evidence.md)
