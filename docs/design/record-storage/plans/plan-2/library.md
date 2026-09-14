# PLAN-2：一 Run 一 SQLite application file —— Library

下列调用面保存本候选原本遵守的逻辑 API。
本候选因 final single-file 容量冲突而退出 live 比较，API 一致不能弥补该物理不兼容。

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
`content.stream(handle)` 按 rows 有界读取，禁止先形成完整 `Uint8Array`。
`content.byteLength(handle)` 只读 logical descriptor；`content.bytes(handle)` / `content.text(handle)` 整体读取，并可因本机 admission 失败。
它们没有 Core 64 MiB 上限；family `maximumBytes` 仍只表达领域值约束。

`requireComplete()`、publish 与 migration 流式、可取消地遍历 closure；它们不为 heap、RSS 或时延设性能承诺。

## 失败

| 阶段 | 失败 |
|---|---|
| storage actor unavailable/closed | existing writer closed 或 typed storage failure |
| append item encode/insert | schema、budget 或 SQLite I/O failure；Run fail closed |
| append 达到 cap | existing `omitted` receipt；不插入 item row |
| Content source/chunk insert | source、budget、binding、I/O 或 cancellation failure；draft 不成为 logical Content |
| ordinary open/read | application/schema/requested closure invalid，或 typed I/O failure |
| final export/publish | integrity、disk、fsync、rename 或 destination verification failure；无成功 receipt |
| final DB 达到 durable-member ceiling | 无法兑现共同 Case；不能通过扩大或豁免 ceiling 发布 |

错误不暴露 SQL text、rowid、database filename 或 page number。
durable schema/digest mismatch 是 invalid/corrupt；取消、memory/time admission、disk/inode exhaustion 与 I/O 是 typed resource failure。
