# PLAN-2：一 Run 一 SQLite application file —— Library

SQLite 不进入 public configuration。
三个逻辑输入面与现有 Record Library 保持一致。

## 定义与写入

```ts
import { Schema } from "effect";
import {
  defineAttemptRecord,
  defineAttemptRecordCollection,
  makeRecordHost,
  RecordBytesContentSchema,
} from "niceeval/record";

const attemptArtifact = defineAttemptRecord({
  family: "acme.artifact",
  schema: Schema.Struct({
    name: Schema.String,
    bytes: RecordBytesContentSchema,
  }),
  validate: () => [],
});

const turnMetrics = defineAttemptRecordCollection({
  family: "acme.turn-metrics",
  item: Schema.Struct({
    sessionIndex: Schema.Number,
    turnIndex: Schema.Number,
    latencyMs: Schema.Number,
  }),
});

const host = makeRecordHost({ records: [attemptArtifact, turnMetrics] });
```

rich value 和 Content source：

```ts
yield* attempt.record.write(attemptArtifact(({ content }) => ({
  name: "trace.bin",
  bytes: content.stream(byteStream),
})));
```

simple collection：

```ts
yield* attempt.record.start(turnMetrics);
const receipt = yield* attempt.record.append(turnMetrics({
  sessionIndex: 0,
  turnIndex: 1,
  latencyMs: 18,
}));
```

`receipt` 仍是：

```ts
type AttemptRecordAppendReceipt =
  | { readonly state: "retained" }
  | { readonly state: "omitted"; readonly reason: "collection-cap-reached" };
```

没有 `sql`、`transaction`、`table`、`chunkSize`、`databasePath`、`journalMode` 或 storage option。

## 读取

```ts
const fact = yield* reader.read(selectedAttempt.owner, attemptArtifact);
const collection = yield* reader.read(selectedAttempt.owner, turnMetrics);
```

ordinary read 仍返回现有 Attachment 六态。
collection available value仍是完整 `{ collection, items }`；Host 查询 item rows 后形成 array。
SQLite ordinal 或 rowid 不成为 public cursor。

Content handle 在 reader Scope 中惰性消费。
Host 只在消费时读取对应 chunk rows，并验证 ordered chunk digest、overall length 与 overall SHA-256。

## 失败

| 阶段 | 失败 |
|---|---|
| storage actor unavailable/closed | existing writer closed 或 typed storage failure |
| append item encode/insert | schema、budget 或 SQLite I/O failure；Run fail closed |
| append 达到 cap | existing `omitted` receipt；不插入 item row |
| Content source/chunk insert | source、budget、binding、I/O 或 cancellation failure；draft 不成为 logical Content |
| ordinary open/read | application/schema/requested closure invalid，或 typed I/O failure |
| final export/publish | integrity、disk、fsync、rename 或 destination verification failure；无成功 receipt |

错误不暴露 SQL text、rowid、database filename 或 page number。
