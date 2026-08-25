# PLAN-1：JSON envelope + Host 私有 packs —— Library

物理 layout 不增加公开配置或导出。
作者面保持 rich definition、Attempt Record collection 与逻辑 Content 三种输入。

## 定义与写入

```ts
import { Schema } from "effect";
import {
  defineAttemptRecord,
  defineAttemptRecordCollection,
  defineRunRecord,
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

rich value 继续使用 create-once `write`：

```ts
yield* attempt.record.write(attemptArtifact(({ content }) => ({
  name: "trace.bin",
  bytes: content.stream(byteStream),
})));
```

simple collection 继续使用 Attempt-only `start/append`：

```ts
yield* attempt.record.start(turnMetrics);
const receipt = yield* attempt.record.append(turnMetrics({
  sessionIndex: 0,
  turnIndex: 1,
  latencyMs: 18,
}));
```

`receipt` 的穷尽形状保持：

```ts
type AttemptRecordAppendReceipt =
  | { readonly state: "retained" }
  | { readonly state: "omitted"; readonly reason: "collection-cap-reached" };
```

没有公开 `pack()`、`segment()`、`objectKey`、`storagePolicy`、path 或 physical stream handle。

## 读取

```ts
const fact = yield* reader.read(selectedAttempt.owner, attemptArtifact);
const collection = yield* reader.read(selectedAttempt.owner, turnMetrics);
```

rich read 返回现有六态 `RecordAttachmentRead<Value>`。
collection 的 available value 仍是完整 `{ collection, items }`；本候选不增加 public item pagination。

Content handle 仍由 reader 的 scope-owned content API 消费。
只有调用方读取 Content 时，Host 才按 private index 读取所需 pack ranges 并验证 logical length/digest。

## 失败

| 阶段 | 失败 |
|---|---|
| append item encode | existing schema/closure write failure；未写入 frame |
| append 达到 cap | `omitted` receipt；安全 prefix 在 Attempt complete 时成为 partial |
| Content source/pack write | typed source、I/O、budget 或 digest failure；Run fail closed |
| ordinary read | requested envelope/frame/index invalid，或 typed I/O failure |
| `requireComplete()` | 任一 Core、Attachment、pack、reference 或 Seal closure invalid |

这些错误不暴露 pack path、offset 或 segment key。
