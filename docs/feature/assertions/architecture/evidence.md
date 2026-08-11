# Assertions —— evidence

每条 Assertion 在采集前声明需要哪些 Attempt-owned `RecordAttachment` 证据。collector 使用这些声明决定缺少数据时形成 available score 还是 unavailable result；它从不把“没有读到”解释为“没有发生”。

## 三个不同问题

`RecordAttachmentEnvelopeV1.collection` 说明已保存 payload 的采集集合是 complete，还是带 reason 的 partial。Attachment 目录不存在时，reader 返回 `RecordAttachmentRead.unavailable`；它不保存 durable absent descriptor。reader 另以 `available`、`unavailable`、`migration-required`、`unsupported` 或 `invalid` 表示读取状态。payload 自己还可以声明 sampled、redacted、truncated 等语义 limitation。

三者不能合并：

- 已保存的 NDJSON Attachment 可以由 `collection.partial` 表明采集集合不完整。
- 未采集和不适用使相应 Assertion 写出带 reason 的 `unavailable` result，不伪造成空数组。
- 缺少 Attachment 目录是 `unavailable`；envelope、payload 或 blob 损坏才是 `invalid`。
- 未安装或无法解释某个 Attachment schema 是 `unsupported`。
- `collection.complete` 不能抹掉 payload 的 sampled/redacted limitation。

被请求的 invalid Attachment 使该读取失败。未请求的 Attachment 不影响其它 Assertion、Sample 或 Report。

每个 `subjectSnapshotRef` 都能追到读取时的 sealed Observation。根 `t` scope 的引用必须表达 vector cut，
让离线读取面能说明它读到了哪些 Session 前缀。

| 需求 | 使用者 | Attachment 证据不能交付时 |
|---|---|---|
| required | 非 optional Assertion | 写 `availability: "required"` 与 `result.state: "unavailable"`；producer 按规则形成 Verdict。 |
| optional | 带 `.optional()` 的 Assertion | 写 `availability: "optional"` 与 `result.state: "unavailable"`；不单独改变 Verdict。 |
| supplemental | 只供详情或 Report 使用的数据 | 写具名 diagnostic；不伪造 Assertion 数据。 |

同一 Attachment 同时被 required 与 optional 使用时，按 required 处理。一次采集成功后，所有消费者读取同一份 Attempt-owned 数据。

```ts
t.check(
  await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]),
  commandSucceeded(),
);
```

`await` 先取得 `CommandResult`，随后 `t.check` 把它作为 subject `a` 登记。这个 subject snapshot
至少保留：

值 matcher 消费显式传入的值。Sandbox、usage、diff、conversation、tool 和 telemetry 断言消费 producer 已经规范化的运行数据；保存时，各领域拥有自己的 RecordAttachment。Judge 消费默认材料或 `{ on }` 指定的材料。

Runner 在收尾前读取 collector 的需求清单。采集失败只影响登记了该 Attachment 的消费者；producer 在 whole Run seal 前一次形成稳定 Assertions Attachment 与独立 Verdict Attachment，不让 Report 事后重算。

collector 在把已求值的检查归一为 entry 时立即分配并保存 attachment-local `entryId`，例如 `ae_k7m2q4v9x6c8d1n5r3s0`。它在 seal 前拒绝同一 Assertions Attachment 中的重复 ID；缺少或重复 ID 是 Assertions Attachment invalid，不是 evidence unavailable。ID 不从证据内容、条目名、`entries` 位置或详情 route 得到。

## 相关阅读

- [Assertions 架构](../architecture.md)
- [RecordAttachment 读取状态](../../record/library.md#attachment-写入与读取)
- [Verdict 规则](../../verdict/architecture.md)
- [Adapter 证据](../../adapters/architecture/evidence.md)
