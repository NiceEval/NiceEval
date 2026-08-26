# Record Library

`niceeval/record` 提供 Effect v3 的 Record definition、owner-scoped writer、bounded reader、Host 与 maintenance API。
Library 不公开 SQLite capability，也不在内部调用 `Effect.runPromise`。

Record 宿主 SDK `RecordHostSDK` 组合这些入口。Attempt 写会话 `AttemptWriteSession` 只把匹配 owner 的 `records` 能力交给
capture authority。每次调用形成一个 Record write command；family 的 durable family revision 也称
Attachment persistence revision。

## Definition

```ts
import { Record } from "niceeval/record";
import { Schema } from "effect";

export const artifact = Record.attempt({
  family: "niceeval.artifacts",
  schema: ArtifactSchema,
  validate: validateArtifact,
});

export const runArtifact = Record.run({
  family: "acme.run-artifact",
  schema: RunArtifactSchema,
  validate: validateRunArtifact,
});

export const turnMetrics = Record.attemptCollection({
  family: "acme.turn-metrics",
  item: Schema.Struct({
    sessionIndex: Schema.Number,
    turnIndex: Schema.Number,
    latencyMs: Schema.Number,
  }),
});
```

每次调用返回 nominal definition。它固定 owner、稳定无版本 `family`、current Schema 与 named validation；同一个值也是
writer selector、reader selector、reference target 与 Host contribution。字符串、结构相同对象与类型断言不能构造同等
capability。

`Record.attemptCollection()` 只接受 context-free plain-data item，不接受 Run owner、Content、reference、builder、
Stream、SQL、custom transaction 或 chunk policy。需要 rich validation、Content/reference closure 或 Run owner 时使用
`Record.attempt()` / `Record.run()`。

## Owner-scoped writer

```ts
yield* attempt.records.write(artifact, value);

yield* run.records.write(runArtifact, ({ content }) => ({
  report: content.text(reportStream),
}));

const admitted = yield* attempt.records.append(turnMetrics, metric);
yield* attempt.records.appendAll(turnMetrics, metricsStream);
yield* attempt.records.close(turnMetrics, { state: "complete" });
```

`records.write(definition, valueOrBuilder)` 是 rich family 的 create-once write。builder 在 capture fiber 中、SQLite
transaction 外恰好执行一次。Host 完整读取并验证 Content source，把 logical closure 放入 durable staging 后才返回；
busy retry 只重用冻结 bytes，不重新执行 builder 或读取可变 input。

`append()` 在原子 enqueue 前执行 Schema encode 与 immutable snapshot。成功返回 admission acknowledgment，表示 command 已
取得 Host sequence 并进入 mailbox；它不表示 transaction commit 或 fsync。`appendAll(Stream)` 保留 source order，
但 Host 根据自己的 row/byte budget 分 batch；输入 Stream chunk 不决定 transaction 或 durable row，多个 source 可以在
batch boundary 交错。

mailbox 同时限制 encoded byte count 与 command count。容量不足时 producer 受 backpressure，不丢 item。调用在原子 enqueue
前取消时不产生 sequence；enqueue 后取消只结束调用方等待，command 留在 Attempt backlog，并由 completion fence 结算。

每个 durable command 冻结 `(writerGeneration, owner, sequence)`、definition/family、logical identity、canonical bytes 与
digest。完全相同的 retry 重读 committed success；同一 command identity 携带不同 identity 或 digest 时返回
`record-command-conflict` 并 poison writer。

## Collection completion

`records.close(definition, { state })` 是显式领域 fence：

- 从未 append、`appendAll` 或 close 的 definition 是 `not-recorded`；
- `close(..., { state: "complete" })` 可以发布 complete-empty；
- `partial` 必须携带 definition 允许的 non-empty typed limitations；
- Stream 正常结束不自动证明 collection complete；
- interruption、Schema failure、storage failure 或 cap 不会被 Host 猜成业务 partial。

`attempt.complete(outcome)` 先拒绝新 admission，再等待全部已接纳 sequence 提交。它拒绝仍 active 但未 close 的 collection；
后台 encode/storage failure poison Attempt，不能静默少写并标成 complete。`run.seal()` 只在所有 Attempt completion fence
成功后开始 sealing。

## Host

```ts
const host = makeRecordHost({ records });

yield* Effect.scoped(host.openRead({ store }));
yield* Effect.scoped(host.createRun({ store, core }));
yield* Effect.scoped(host.maintenance({ store }));
```

`ProjectRecordStore` 是定位 `.niceeval/record.sqlite` 的 nominal capability；它不能从普通 path 或
`RecordSnapshot` 猜测得到。每个 process 至多一个 dedicated storage worker 串行化本进程 write commands，使 busy wait、
checkpoint 与 fsync 不阻塞运行主线程。短 `query` 直接执行一次 read-only fixed operation，不启动 worker，也不长期
保持 read transaction。

`makeRecordHost({ records })` 冻结 definition composition。第三方 definition 可以参与 Record family composition，但不取得
connection、transaction、authorizer、maintenance、path 或 SQL。Host 是打开 database 与解释 physical schema 的唯一 owner。

## Bounded read 与 collection Stream

```ts
const small = yield* reader.read(owner, turnMetrics);

const opened = yield* reader.openCollection(owner, turnMetrics);
if (opened.state === "available") {
  console.log(opened.collection);
  yield* Stream.runForEach(opened.items, consumeMetric);
}
```

`read()` 在读取 item rows 前检查 count、canonical bytes、nodes/depth 与 Content metadata。超过 whole-value 上限时返回
`record-content-admission`，不会先构造完整数组。适合大 collection 的 `openCollection()` 只接受 sealed owner，并返回：

- collection logical identity 与 `LogicalSealIdentity`；
- item count、canonical digest、`complete | partial` 与 limitations；
- 可重新执行的 self-scoped bounded `items` Stream。

每次执行 Stream 都取得 shared storage-generation lease 与自己的 read-only connection，按 private ordinal 分页。每页交付后
释放临时 buffer；结束、失败、提前停止或 interruption 都立即关闭 connection。Stream 不跨整个消费期持有一个 SQLite read
transaction。

storage migration 等待 generation lease。只改变 physical generation 时，下一次执行重新验证同一 Logical Seal；family/data
migration 改变 logical identity 时返回 `previous-result` / `restart-required`。page、ordinal、rowid、connection、statement 与
transaction 不进入 metadata 或 item。

## Content

读取侧的 Content 是 sealed immutable capability：

```ts
const size = yield* content.byteLength(handle);
const bytes = yield* content.bytes(handle);
const text = yield* content.text(handle);
yield* Stream.runForEach(content.stream(handle), consumeChunk);
```

`byteLength` 只读 metadata。`bytes` / `text` 在分配前执行 whole-value admission；拒绝时 Attachment 仍 available，并提示使用
`stream`。`stream` 按 private ordinal 读取 bounded chunk rows，不把完整 BLOB 绑定成单个 `TypedArray`。所有入口都是
self-scoped；Scope 关闭会释放 connection、buffer 与 generation lease。

## Read states 与 failures

局部 read 的数据状态为 `not-recorded | available | invalid | migration-required | unsupported`。unknown family 不影响无关
definition；direct/reference closure 需要它时返回 `family-definition-required`。完整 publication、Snapshot 与
`requireComplete()` 必须验证整个 inventory，不能把 unknown family 解释成成功。

主要 typed failure 包括：

- `record-write-busy`、`record-snapshot-busy`；
- `record-schema-migration-required`、`record-schema-unsupported`；
- `record-database-invalid`、`record-seal-incomplete`；
- `record-content-admission`、`record-command-conflict`；
- `family-definition-required`、`migration-required`；
- `user-repository-migration-required`、`user-repository-invalid`。

这些 failure 不形成业务 partial，也不自动重跑 producer。prepared statement result 必须先经过 Effect Schema 或具名 decoder；
safe integer、enum、BLOB length 与 nullable shape 不依赖 TypeScript assertion。
