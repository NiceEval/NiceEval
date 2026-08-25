# PLAN-4 —— Library

## 作者面

作者调用面不暴露 SQLite：

```ts
const artifact = Record.attempt({
  family: "niceeval.artifacts",
  schema: ArtifactSchema,
  validate: validateArtifact,
});

yield* attempt.records.write(artifact, value);

yield* run.records.write(runArtifact, ({ content }) => ({
  report: content.text(reportStream),
}));
```

Content 继续提供 `text`、`bytes` 与 `stream` source。Plain-data collection 使用定义与操作分离的 API：

```ts
const turnMetrics = Record.attemptCollection({
  family: "acme.turn-metrics",
  item: TurnMetricSchema,
});

yield* attempt.records.append(turnMetrics, metric);
yield* attempt.records.appendAll(turnMetrics, metricsStream);
yield* attempt.records.close(turnMetrics, { state: "complete" });
```

Host 在接纳 command 前执行 Schema encode 与 immutable snapshot。mailbox 同时限制 encoded bytes 与 command count；容量不足时 producer 暂停，不丢 item。

调用在原子 enqueue 前被取消时不分配 Host sequence，也不留下 command。原子 enqueue 完成后，command 已属于 Attempt backlog；调用方之后被取消只停止等待 ack，不能从 mailbox 撤回该 command。`attempt.complete()` 仍按 sequence 结算它，避免取消与 commit 竞态产生不确定状态。

`append()` 成功只表示 canonical item 已进入 mailbox，不表示该 item 已 fsync。dispatcher 把多个 append 合成一个 worker message、一张 writer admission ticket 和一个短 transaction；每个 retained item 按同一 `(owner, definition)` 的 admission order 取得 ordinal。

`appendAll()` 保持自己的 source order，但 Host 按 durable row/byte budget 重新分批。输入 Stream chunk 不决定 transaction 或 durable chunk；并发 source 可以在 batch 边界交错。

`close(definition, { state })` 是 collection 的领域 completion fence：

- 从未 append、`appendAll` 或 close 时为 `not-recorded`；
- `close(complete)` 可以形成 complete-empty；
- `close(partial)` 必须带 definition 允许的 non-empty typed limitations；
- Stream 正常结束不自动证明整个 collection complete；
- interruption、Schema 或 storage failure 不自动改写成领域 partial。

`attempt.complete()` 先关闭新 admission，再等待全部已接纳 sequence 提交。它拒绝仍激活但未 close 的 collection；后台失败 poison Attempt，而不是静默少写后标为 complete。`run.seal()` 只在全部 Attempt fence 成功后进入 sealing。

builder 在 capture fiber 中、SQLite transaction 外恰好执行一次。`write()` 只有在完整 Attachment closure 进入 durable staging 后才成功；SQLite busy retry 不重新执行 builder，也不重新读取可变 value 或 Content Stream。

每个 durable command 冻结 `(writerGeneration, owner, sequence)` identity、definition/family、logical identity、canonical bytes 与 digest。完全相同的 retry 重读 committed result；相同 command identity 携带不同 identity 或 digest 时返回 `record-command-conflict` 并 poison writer，不能新增、取代或当作成功 duplicate。

Definition 不能提供 SQL、table、column、index、pragma、transaction 或 chunk size。

## Host 面

```ts
const host = makeRecordHost({ records });

yield* Effect.scoped(host.openRead({ root }));
yield* Effect.scoped(host.createRun({ root, core }));
yield* Effect.scoped(host.maintenance({ root }));
```

Host 把每个 process 的 write commands 交给一个 dedicated storage worker。
worker 使用 `node:sqlite`，串行化进程内 command，并让 busy wait、checkpoint 与 fsync 不阻塞运行主线程。

短生命周期 `show/query` 不启动 storage worker。
它直接打开 read-only `node:sqlite` connection，执行一个固定 operation 后关闭；持续 Inspection session 也不能长期保持 read transaction。

## Content

`content.stream(handle)` 按 ordinal query chunk rows，并在每个 chunk 交付后释放临时 buffer。它不把完整 BLOB 绑定或读成一个 `TypedArray`。

`content.byteLength(handle)` 只读 metadata。`content.bytes/text` 在分配前执行 whole-value admission；拒绝整体读取时 Attachment 仍 available，并提示调用 `stream`。

## Read session

整体读取与流式 collection 是两个明确入口：

```ts
const small = yield* reader.read(owner, turnMetrics);

const opened = yield* reader.openCollection(owner, turnMetrics);
if (opened.state === "available") {
  console.log(opened.collection);
  yield* Stream.runForEach(opened.items, consumeMetric);
}
```

`read()` 在读取 rows 前检查 item count、canonical bytes、nodes/depth 与 Content metadata。超过上限时，它返回 `record-content-admission`，不会先构造完整数组。

整体读取只包含 definition structure 与 collection items。Content leaf 仍是 logical immutable capability，只暴露 identity、byte length 与 digest。

`content.read()` 单独执行 whole-value admission；`content.stream()` 返回 self-scoped bounded Stream。

`openCollection()` 只接受 sealed owner，并返回 logical collection identity、Logical Run Seal identity、item count、digest、`complete | partial` 与 limitations。partial 是已发布的 capture limitation，不表示 collection 仍在增长。

items 是可重新执行的 self-scoped Stream。每次执行取得 shared storage-generation lease 和自己的 read-only connection，再按 private ordinal 做 bounded page query。它不会让同一个 SQLite read transaction 持续整个消费期；结束、失败、提前停止或 interruption 都立即关闭 connection。

storage migration 必须等 generation lease 释放。只改变 physical generation 时，下次执行 Stream 重新验证同一 Logical Seal；family/data migration 改变 logical identity 时返回 `previous-result` / `restart-required`。page、ordinal、rowid、connection 与 statement 都不进入公共 metadata 或 element。

普通读取使用固定 prepared query：

- 按 Run ID、Attempt locator 与 owner/family 查找；
- 只选择 sealed cutoff 内 facts；
- 只在调用方消费 Content 时读取 chunk rows；
- 不返回 database row、statement、connection 或 transaction handle。

固定 Inspection Operations 可以建立自己的 closed result，但不能取得 SQL capability。Record Host 仍是打开 database 和解释 storage schema 的唯一 owner。

prepared statement result 不能直接越过 Host 边界。
每个 result 先经过 Effect Schema 或具名 decoder，safe integer、enum、BLOB length 与 nullable shape 不依赖 TypeScript assertion。

## Failures

本候选增加或具体化以下 typed failure：

- `record-write-busy`：write lock 在 operation deadline 前未取得；
- `record-schema-migration-required`：database storage revision 不是 current；
- `record-schema-unsupported`：格式或 schema identity 不属于相邻可迁移链；
- `record-snapshot-busy`：一致 snapshot 无法在 deadline 和资源预算内形成；
- `record-database-invalid`：SQLite structure 或 NiceEval schema allowlist 无效；
- `record-content-admission`：whole-value read 超过本机 admission，stream 仍可用；
- `record-command-conflict`：同一 command identity 被不同 owner、generation、definition、logical identity 或 canonical digest 复用；writer fail closed；
- `service-state-migration-required`：用户 Service state module 存在相邻 migration，但当前 operation 不获准自动维护；
- `service-state-invalid`：Service namespace、schema identity 或 typed row 不合法。

这些 failure 不形成 business partial，也不自动重跑 producer。
