# Assertions —— evidence

Assertion 读取的材料必须在 Attempt 发布前归一为有界 snapshot 或稳定 ref。collector 从不把“没有读到”解释成“没有发生”，也不让 Report 在事后重新采集。

## 三个不同问题

Attachment collection、Attachment read 和 Assertion coverage 是三个不同层次。它们不能互相替代：

| 层次 | 说明 |
|---|---|
| collection | producer 已保存集合是 complete 还是 partial，并带原因。 |
| read | requested Attachment 是 available、unavailable、migration-required、unsupported 或 invalid。 |
| coverage | 这条 Assertion 的材料是 complete、partial、unavailable 还是 not-applicable，以及 limitations。 |

缺少 Attachment directory 是 read unavailable；envelope、blob 或 payload 损坏是 read invalid；未安装 schema 是 unsupported。partial collection、sampling、redaction 与 truncation 不能被 reader 消掉。

## 显式 value snapshot

```ts
t.check(
  await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]),
  commandSucceeded(),
);
```

`await` 先取得 `CommandResult`，随后 `t.check` 保存该次读取的安全 subject snapshot 或 owner-local ref。snapshot 至少包括 criterion 实际使用的字段、coverage 与 limitations；大内容使用有界 preview 加 blob ref，secret 永不进入 Assertion Attachment。

scope assertion 的 material 是 call-time snapshot。根 `t` 的 ref 必须表达 vector cut，使离线 reader 能说明纳入了哪些 Session 前缀，而不是读取一个可变的“最后状态”。

## required、optional 与 supplemental

| 需求 | Attachment 不能交付时 |
|---|---|
| required | entry 写入 `coverage: unavailable` 和原因；Verdict 依规则成为 errored。 |
| optional | entry 保留 unavailable，不单独改变 Verdict。 |
| supplemental | 写入对应 diagnostic；不伪造 Assertion result。 |

同一材料同时被 required 与 optional 使用时按 required 处理。一次采集成功后，所有消费者读取同一份 Attempt-owned 数据。Sandbox、usage、diff、conversation、tool 与 telemetry 各自拥有 Attachment；Judge 使用默认材料或 `{ on }` 指定材料。

## 发布边界

collector 在归一已求值 entry 时分配 attachment-local `entryId`，并拒绝重复 ID。它在 whole Run seal 前写稳定 Assertions Attachment 与独立 Verdict Attachment；采集失败只影响声明了该材料的 entry。

第三方 criterion 的 schema 不能解码时，entry 局部显示 unsupported 或 invalid。未请求的 Attachment 与其它 entry 不受影响。

## 相关阅读

- [Assertions 架构](../architecture.md)
- [RecordAttachment 读取状态](../../record/library.md#recordattachment-写入与读取)
- [Verdict 规则](../../verdict/architecture.md)
- [Adapter evidence](../../adapters/architecture/evidence.md)
