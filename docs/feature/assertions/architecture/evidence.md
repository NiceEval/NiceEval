# Assertions —— evidence

Assertion 的材料必须在 Attempt 发布前归一为有界 snapshot，或 Assertions Attachment 自己 closure 中的
blob。producer 从不把“没有读到”解释成“没有发生”，Report 也不在事后重新采集。

## 读取状态与 entry coverage

只有两个层次，且不能互相替代：

| 层次 | 说明 |
|---|---|
| `RecordAttachmentRead` | 请求的 Assertions Attachment 是 `available`、`unavailable`、`migration-required`、`migration-unavailable`、`unsupported` 或 `invalid`。`available` 已保证 exact payload 与完整 own blob closure。 |
| entry coverage | 当 Attachment 为 available 时，每条 Assertion 的 material 是 `complete`、`partial`、`unavailable` 或 `not-applicable`，并带该 entry 的 limitations／原因。 |

v1 没有通用 Attachment 完整度字段。producer 少采、sampling、redaction 与 truncation 都写进受影响 entry 的
coverage 和 limitations；reader 不会把它们消掉。缺少目录是 read `unavailable`，envelope、payload、blob 或
closure 损坏是 read `invalid`，未安装 family/schema 是 `unsupported`。

## 显式 value snapshot

```ts
t.check(
  await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]),
  commandSucceeded(),
);
```

`await` 先取得 `CommandResult`，随后 `t.check` 保存该次读取的安全 subject snapshot，或 Assertions Attachment
自有 blob 的有界 preview + ref。snapshot 至少包括 criterion 实际使用的字段、coverage 与 limitations；secret
永不进入 Assertions Attachment。

scope Assertion 的 material 是 call-time snapshot。根 `t` 把 vector cut 归一为有界 JSON，使离线 reader 能说明
纳入了哪些 Session 前缀，而不是持有一个可变的“最后状态”或跨 Attachment ref。

## required、optional 与 supplemental

| 需求 | producer 不能取得材料时 |
|---|---|
| required | entry 写入 `coverage: unavailable` 和具名原因；Verdict 依规则成为 errored。 |
| optional | entry 保留 unavailable，不单独改变 Verdict。 |
| supplemental | 写入对应 diagnostic；不伪造 Assertion result。 |

同一材料同时被 required 与 optional 使用时按 required 处理。一次采集成功后，多个 entry 可复制同一份有界
snapshot。若需要保留大 bytes，producer 必须为每个 material mint 独立 own blob ref；它们不能共享 ref，也不能借用
Sandbox、usage、diff、conversation、tool 或 telemetry Attachment 的 blob ref。

## 发布边界

collector 在归一已求值 entry 时分配 attachment-local `entryId`，并拒绝重复 ID。它在 whole Run seal 前写稳定
Assertions Attachment 与独立 Verdict Attachment；采集失败只影响声明了该材料的 entry。

第三方 criterion 的 schema 不能解码时，entry 局部显示 unsupported 或 invalid。未请求的 Attachment 与其它
entry 不受影响。

## 相关阅读

- [Assertions 架构](../architecture.md)
- [RecordAttachment 读取状态](../../record/library.md#recordattachment-family-与读取状态)
- [Verdict 规则](../../verdict/architecture.md)
- [Adapter evidence](../../adapters/architecture/evidence.md)
