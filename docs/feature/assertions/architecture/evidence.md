# Assertions —— evidence

Assertion 的材料必须在 Attempt 发布前归一为 Assertions Attachment 自己 closure 中的 sealed content。producer 从不把“没有读到”解释成“没有发生”，Analysis 与 Report 也不在事后重新采集。

## family Host 与 entry coverage

读取时只有两个不能互相替代的层次：

| 层次 | 说明 |
|---|---|
| family Host | 请求的 Assertions family 是 `available`、`not-recorded` 或 `invalid`。只有 `available` 已保证 exact value 与完整 own content closure。 |
| entry coverage | 当 Assertions 为 `available` 时，每条 Assertion 的 material 是 `complete`、`partial`、`unavailable` 或 `not-applicable`，并带该 entry 的 limitations／原因。 |

revision 1 没有通用 Attachment 完整度字段。producer 少采、sampling、redaction 与 truncation 都写进受影响 entry 的 coverage 和 limitations；reader 不会把它们消掉。未写入已贡献 family 是 `not-recorded`，envelope、payload、content 或 closure 损坏是 `invalid`。future revision 或不相容 durable bytes 在 reader session 形成前返回 `unsupported-format`。完整闭包与 source-local read 的定义见 [Record architecture](../../record/architecture.md#attachment-closure-惰性读取与-cache)。

## 显式 value snapshot

```ts
t.check(
  await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]),
  commandSucceeded(),
);
```

`await` 先取得 `CommandResult`，随后 `t.check` 把该次读取的安全 subject 编码为 Assertions Attachment 自有 sealed content，并保存有界 preview。材料至少包括 criterion 实际使用的字段、coverage 与 limitations；secret 永不进入 Assertions Attachment。

scope Assertion 的 material 是 call-time snapshot。根 `t` 把 vector cut 归一为有界 JSON，使离线 reader 能说明纳入了哪些 Session 前缀，而不是持有一个可变的“最后状态”或跨 Attachment ref。

Sandbox diff Assertion 同样保存自己实际判定所需的安全 summary、evidence 与限制。完整 diff bytes 仍只属于 FileChanges family；Assertions 不借用它的 content handle，也不因不能保留全文而假装没有观察到变化。

## required、optional 与 supplemental

| 需求 | producer 不能取得材料时 |
|---|---|
| required | entry 写入 `coverage: unavailable` 和具名原因；[Verdict](../../verdict/architecture.md) 依规则成为 `errored`。 |
| optional | entry 保留 unavailable，不单独改变 Verdict。 |
| supplemental | 写入对应 diagnostic；不伪造 Assertion result。 |

同一材料同时被 required 与 optional 使用时按 required 处理。若多个 entry 需要同一份 bytes，producer 必须为每个 material mint 独立 own content handle。

这些 handle 不能共享，也不能借用 Sandbox、usage、diff、conversation、tool 或 telemetry family 的 handle。

## 发布边界

collector 在归一已求值 entry 时分配 attachment-local `entryId`，并拒绝重复 ID。它在 whole Run seal 前写稳定的 Assertions payload，其中 source navigation row 也只能以 `entryId` join 既有 Sources item；Verdict 与 Score 都在读侧从这些已封口事实形成。

第三方 criterion 的 schema 不能解码时，entry 局部显示 `unsupported` 或 `invalid`。其它 entry、以及不依赖该 entry 的读侧结果不受影响。

## 相关阅读

- [Assertions 架构](../architecture.md)
- [Source sites](source-sites.md)
- [Record architecture](../../record/architecture.md)
- [Verdict 规则](../../verdict/architecture.md)
- [Analysis Library](../../analysis/library.md)
- [Adapter evidence](../../adapters/architecture/evidence.md)
