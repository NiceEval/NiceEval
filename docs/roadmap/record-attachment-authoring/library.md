# RecordAttachment 作者 SDK —— Library

RecordAttachment 作者 API、底层 reader、writer 与 migration operation 统一从 `niceeval/record` 导出。
Effect 类型均指 Effect 3.22.1。

## 一次定义完整 family

```ts
import { Effect, Schema } from "effect";
import { defineRecordAttachment } from "niceeval/record";

const gpuEnergy = defineRecordAttachment({
  owner: "attempt",
  name: "com.example.gpu-energy",
  versions: {
    v1: {
      schema: Schema.Struct({
        joules: Schema.Number,
        source: Schema.Literal("device-estimate"),
      }),
      blobRefs: () => [],
    },
    v2: {
      schema: Schema.Struct({
        joules: Schema.Number,
        source: Schema.Literal("device-estimate"),
        uncertainty: Schema.NullOr(Schema.Number),
      }),
      blobRefs: () => [],
    },
  },
  current: "v2",
  migrations: ({ v1, v2 }) => ({
    v1: {
      to: v2,
      migrate: (source, target) =>
        Effect.succeed(target.value({
          ...source.payload,
          uncertainty: null,
        })),
    },
  }),
});
```

version key 必须是从 `v1` 开始的连续十进制序列，`current` 必须是最大的 key。package 从 `name` 与 key
唯一形成 `<name>/vN`，作者不重复填写 `schemaId`。

`versions` 是 keyed record。`migrations` callback 收到每个 version 的 typed token；每个非 current key 在返回
record 中恰有一个同 key entry，`to` 必须是下一版本 token。显式 `to` 为 converter 提供目标 contextual type，也让 code review 能直接看到 edge。缺边、额外边、
跳边、倒序、分叉、非最大 current 与重复 schema identity 都在 definition 阶段拒绝。

每个 version 的 `blobRefs(payload)` 按 payload 出现顺序穷尽该版本全部 `RecordBlobRef`。零 blob payload
显式返回 `[]`；这不是可选提示。

## 不可无损迁移

不能从旧事实推出新事实时，definition 必须把该边声明为 unavailable：

```ts
migrations: ({ v1, v2 }) => ({
  v1: {
    to: v2,
    unavailable: {
      reason: "v1 did not record the measurement interval",
    },
  },
})
```

`migrate` 与 `unavailable` 是穷尽联合，不能同时出现。unavailable 是已定语义，不是 converter failure。

converter 的完整形状是：

```ts
interface RecordAttachmentMigrationTarget<Owner, Payload> {
  value(payload: Payload): RecordAttachmentWrite<Owner, never, never>;

  create<const Blobs extends RecordBlobDrafts>(
    build: (
      blobs: RecordAttachmentBlobBuilder,
    ) => RecordAttachmentBlobBuild<Payload, Blobs>,
  ): RecordAttachmentWrite<Owner, RecordBlobErrors<Blobs>, never>;
}

type RecordAttachmentConverter<Owner, From, To, E> = (
  source: RecordAttachmentValue<From>,
  target: RecordAttachmentMigrationTarget<Owner, To>,
) => Effect.Effect<RecordAttachmentWrite<Owner, E, never>, E, never>;
```

`source` 是已 exact decode、完整 materialize 的旧 payload 与 blob closure。converter 只能用
`source.blobs.bytes(ref)` 读取旧 closure，并经 `target.value()` 或 `target.create()` 构造新 closure。它没有
root、path、clock、network、当前 Agent、Eval 或 Plugin context；`R = never` 禁止依赖 NiceEval runtime service。

## Producer allowlist

definition 不授予写权限。Eval、Experiment、Plugin 与内建 producer 都把 definition identity 加入自己的
owner-local allowlist：

```ts
export default defineEval({
  recordAttachments: [gpuEnergy],
  async test(t) {
    await t.record(gpuEnergy, {
      joules: 18.2,
      source: "device-estimate",
      uncertainty: null,
    });
  },
});
```

Run-owned definition 只能出现在 Experiment 或 Run producer allowlist；Attempt-owned definition 只能出现在 Eval、
Attempt Plugin 或 Attempt producer allowlist。动态 JavaScript 在 definition/link 阶段得到 owner mismatch。

allowlist 不决定 producer behavior identity，也不自动建立 reuse requirement。形成 payload 的算法代次继续进入
对应 Eval、Experiment 或 Plugin 的 canonical behavior identity；需要 current Attachment 才能 carry 的 owner
contract 另行声明 reuse requirement。schema version 不能替代这两项语义。

## Owner-local record context

```ts
interface RecordAttachmentContext<
  Owner extends "run" | "attempt",
  Allowed,
> {
  record<Definition extends Allowed>(
    attachment: Definition,
    payload: CurrentPayload<Definition>,
  ): Promise<void>;

  record<Definition extends Allowed, const Blobs extends RecordBlobDrafts>(
    attachment: Definition,
    build: (
      blobs: RecordAttachmentBlobBuilder,
    ) => RecordAttachmentBlobBuild<CurrentPayload<Definition>, Blobs>,
  ): Promise<void>;
}

type AttemptRecordContext<Allowed> =
  RecordAttachmentContext<"attempt", Allowed>;

type RunRecordContext<Allowed> =
  RecordAttachmentContext<"run", Allowed>;
```

直接 payload overload 只适用于 `blobRefs(payload)` 为空的 current value。blob-backed payload 使用 builder；
`blobs.add()` 只接受 `RecordBlobSource`，并 mint 本次 write 独占的 ref。两种 overload 最终产生同一种 opaque
`RecordAttachmentWrite`，没有 raw JSON、path、blob key 或 bytes fallback。

`record()` 是 eager Promise command。调用发生时同步验证 context lease、owner 与 allowlist，并原子 reserve
family；Promise 承担 schema encode、blob Stream 和 generic writer 的异步完成。调用者应 `await` 以取得局部失败，
host 仍跟踪全部 in-flight write，不能靠漏写 `await` 越过封口屏障。

Promise 以具名错误拒绝：

```ts
type RecordAttachmentRecordError =
  | { readonly code: "record-attachment-context-closed" }
  | { readonly code: "record-attachment-wrong-owner" }
  | { readonly code: "record-attachment-undeclared" }
  | { readonly code: "record-attachment-duplicate" }
  | RecordAttachmentPayloadInvalid
  | RecordAttachmentClosureInvalid
  | RecordWriteError;
```

blob source 的具名 failure 保留为 Promise rejection cause，不改写成 payload invalid。

## Application registry

第三方 definition 只通过配置显式安装：

```ts
export default defineConfig({
  recordAttachments: [gpuEnergy],
});
```

该字段安装 definition 自带的 schemas 与 migration graph，供 reader 和 `niceeval migrate` 使用。它不授予任何
producer 写权限。producer allowlist 也不会反向把 definition 隐式加入 application registry。

## 官方 definition

公开 `defineRecordAttachment()` 拒绝 `niceeval.*`。包内 constructor 只额外持有 namespace authority，返回与
第三方相同的 opaque definition。之后官方 definition 经过同一种 producer allowlist、context、generic writer、
application registry、migration runner 与 projector。公共 API 不提供 `official: true` 或 authority token。
