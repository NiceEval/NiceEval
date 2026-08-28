---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 多次 send 怎样收集 Attempt 事实

Host 想在每次 `send` 后保留小型 metric，并让一个 Attempt 跨 Agent Session 持续采集时，使用
`Record.attemptCollection()` 与 `append` / `appendAll(Stream)`。

```ts
const turnMetrics = Record.attemptCollection({
  family: "acme.turn-metrics",
  item: TurnMetricSchema,
});

yield* attempt.records.append(turnMetrics, firstMetric);
yield* attempt.records.appendAll(turnMetrics, laterMetrics);
yield* attempt.records.close(turnMetrics, { state: "complete" });
yield* attempt.complete("completed");
```

item 在原子 enqueue 前完成 Schema encode 与 immutable snapshot；调用者之后改对象不改变 retained fact。每个成功 append 返回
admission acknowledgment，只表示 bounded mailbox 已接纳 sequence。mailbox 同时限制 encoded bytes 与 command count；满时
producer 等待容量，不丢 item或生成 `omitted` 业务结果。

`appendAll(Stream)` 保留自己的 source order，但 durable batches 由 Host 的 row/byte budget 决定。多个 source 可以在 batch
boundary 交错；同一 collection 的 ordinal 反映 Host admission order，业务顺序仍应写入 `sessionIndex`、`turnIndex` 或稳定 ID。

## Cancellation 与 completion

原子 enqueue 前取消不产生 sequence；enqueue 后取消只取消 ack wait，command 继续进入 durable backlog。producer 必须显式
close collection：

- 从未 append、appendAll 或 close：`not-recorded`；
- `close(complete)` 且零项：complete-empty；
- `close(partial)`：必须有 definition 允许的 non-empty typed limitations；
- Stream 结束、Attempt outcome、interruption、Schema/storage failure：都不自动等于 partial。

`attempt.complete()` 关闭新 admission并等待所有 sequence。后台失败或未 close collection 会使 fence 失败，不能静默少写。

## Bounded read

小 collection 可以 `reader.read(owner, turnMetrics)`；Host 在读取 item rows 前检查 count 与 bytes admission。大 collection 使用：

```ts
const opened = yield* reader.openCollection(owner, turnMetrics);
if (opened.state === "available") {
  yield* Stream.runForEach(opened.items, consumeMetric);
}
```

`openCollection()` 返回 count、digest、completion、limitations 与 `LogicalSealIdentity`，不返回完整 items array。Stream 每次执行
取得自己的 read-only connection 与 generation lease，分页读取；提前停止或 interruption 立即释放资源。

whole-value admission 被拒绝时，事实仍是 available，调用方改用上述 Stream；错误不先分配完整 items array：

```text
$ niceeval query explain --request turn-metrics.json
error: record-content-admission
next: use the collection or Content stream
```

局部读取不需要的 unknown family 不阻塞；但 direct/reference closure 或完整操作缺少定义时，命令明确要求启用相应 package：

```text
$ niceeval query explain --request complete-run.json
error: family-definition-required
next: enable the package that defines the required family, then retry
```
