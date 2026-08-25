# PLAN-1：JSON envelope + Host 私有 packs —— Library

物理 layout 不增加公开配置或导出。
作者面保持 rich definition、Attempt Record collection 与逻辑 Content 三种输入。

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

rich value 继续使用 create-once `write`。
`text` / `bytes` 接受调用方已经整体持有的值；`stream` 是任意长度 bytes Content 的规范入口。

```ts
yield* attempt.record.write(attemptArtifact(({ content }) => ({
  name: "trace.bin",
  bytes: content.stream(byteStream),
})));
```

`content.stream()` 只 mint `RecordBytesContentHandle`，不能填入 `RecordTextContentSchema`。
需要 text handle 时使用 `content.text(string)`；这条便利路径已经整体持有并编码字符串，不承诺随 text 长度保持 RSS 常量。

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

没有公开 `pack()`、`segment()`、`rollover()`、`objectKey`、`storagePolicy`、path、member size 或 physical stream handle。

## 读取

```ts
const fact = yield* reader.read(selectedAttempt.owner, attemptArtifact);
const collection = yield* reader.read(selectedAttempt.owner, turnMetrics);

if (fact.state === "available") {
  const byteLength = yield* fact.content.byteLength(fact.value.bytes);
  const chunks = fact.content.stream(fact.value.bytes);
}
```

rich read 返回现有 `RecordAttachmentRead<Value>`；collection available value仍是完整 `{ collection, items }`。
本候选不增加 public item pagination。

Content handle 由 reader 的 Scope-owned content API消费：

```ts
interface RecordAttachmentContentReader {
  readonly byteLength: (
    handle: RecordContentHandle,
  ) => Effect.Effect<number, RecordReaderReadError>;
  readonly bytes: (
    handle: RecordContentHandle,
  ) => Effect.Effect<Uint8Array, RecordReaderReadError>;
  readonly text: (
    handle: RecordTextContentHandle,
  ) => Effect.Effect<string, RecordReaderReadError>;
  readonly stream: (
    handle: RecordContentHandle,
  ) => Stream.Stream<Uint8Array, RecordReaderReadError>;
}
```

`byteLength(handle)` 读取 catalog 认证的 logical descriptor，不打开 Content data。
`stream(handle)` 按 range 提供连续 logical bytes，禁止先形成完整 `Uint8Array`；pack rollover 不形成公开 stream boundary。

`bytes(handle)` / `text(handle)` 一次分配完整 Content。
它们没有 Core byte cap 或公开 `maximumBytes` 参数；Host 根据当前进程资源在分配前执行 whole-value read admission。
被拒绝时返回：

```ts
type RecordContentMaterializationUnavailable = {
  readonly code: "record-content-materialization-unavailable";
  readonly reason: "memory-admission";
  readonly byteLength: number;
  readonly next: "content.stream";
};
```

这个失败不改变 Attachment 的 `available` 状态，也不表示 Record invalid。
错误不包含 path、pack ordinal、offset、page 或 segment key。

## Family value constraint

`recordContent.maximumBytes(n)` 保留为 family 的显式领域值约束。
未声明时没有默认 64 MiB 上限；它不能用于保护 pack、RSS 或磁盘，也不能静默截断 Content。

需要保留安全前缀的 collector 应在 logical value 中显式保存 `partial` 与 limitation，再提交已经形成的 Content。
超过 family `maximumBytes` 的 write fail closed；它不等于 whole-value read admission。

## 失败

| 阶段 | 失败 |
|---|---|
| append item encode | existing schema/closure write failure；未写入 frame |
| append 达到 collection cap | `omitted` receipt；安全 prefix 在 Attempt complete 时成为 partial |
| Content source/family value | typed source 或 family `maximumBytes` failure；Run fail closed |
| storage structure | frame/page/member/path/integer ceiling；Run fail closed，不形成领域 partial |
| `bytes/text` 整体读取 | 本机 admission failure；Attachment 保持 available，提示 `content.stream` |
| ordinary read | requested envelope/root/page/range invalid，或 typed I/O failure |
| `requireComplete()` | 任一 Core、Attachment、pack、reference 或 Seal closure invalid |

多个合法 Content 的总 bytes 与单 Content 超过旧 64 MiB 都不能触发 Core byte-budget failure。
