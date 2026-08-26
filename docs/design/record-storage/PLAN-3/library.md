# PLAN-3：SQLite inventory + 外部 Content packs —— Library

hybrid layout 不增加 public storage option。
作者面仍只有 rich write、Attempt collection start/append 与逻辑 Content。

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

```ts
yield* attempt.record.write(attemptArtifact(({ content }) => ({
  name: "trace.bin",
  bytes: content.stream(byteStream),
})));

yield* attempt.record.start(turnMetrics);
const receipt = yield* attempt.record.append(turnMetrics({
  sessionIndex: 0,
  turnIndex: 1,
  latencyMs: 18,
}));
```

`receipt` 仍是 `retained` 或带 `collection-cap-reached` 的 `omitted`。
没有 API 能要求「这份 Content 进文件」「这个 item 进 SQL」或选择 pack/database。

## 读取

```ts
const fact = yield* reader.read(selectedAttempt.owner, attemptArtifact);
const collection = yield* reader.read(selectedAttempt.owner, turnMetrics);
```

Host 从 SQLite 读取 requested logical payload/items/references。
collection available value仍是完整 `{ collection, items }`。

Content handle 只在消费时打开 external pack ranges。
调用方得到连续 logical bytes，不得到 filesystem path、offset 或 file handle。
`content.stream(handle)` 按 ranges 有界读取，禁止先形成完整 `Uint8Array`。
`content.byteLength(handle)` 只读认证 descriptor，不打开 data。
`content.bytes(handle)` / `content.text(handle)` 整体读取，没有 Core 64 MiB cap；本机 admission 被拒绝时 Attachment 保持 available 并提示 `content.stream`。

`requireComplete()`、publish 与 migration 流式、可取消地遍历 database/pack closure；它们不为 heap、RSS 或时延设性能承诺。

## 失败

| 阶段 | 失败 |
|---|---|
| append item encode/SQLite insert | schema、cap、actor 或 database I/O failure |
| Content source/pack write | source、family value、structure、file I/O 或 digest failure |
| `bytes/text` 整体读取 | 本机 admission failure；不是 database/pack corruption |
| Attachment finalize | database descriptor 与 pack/index closure 不一致；Run fail closed |
| ordinary read | requested SQLite row或 external Content closure invalid |
| full validation | database、pack、reference、Seal 或 directory inventory 任一 invalid |
| publication | close/checkpoint/export、fsync、rename 或 destination verification failure |

错误只报告 logical owner/family/Content 和阶段，不泄漏 database/pack path。
durable database/pack mismatch 是 invalid/corrupt；取消、memory/time admission、disk/inode exhaustion 与 I/O 是 typed resource failure。
