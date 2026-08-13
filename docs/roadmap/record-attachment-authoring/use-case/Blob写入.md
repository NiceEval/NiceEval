# Blob-backed 事实

领域 producer 仍先形成 sealed value。adapter 用 current target 的 `create()` 构造 payload 与 owner-local blob closure：

```ts
const transcriptRecord = defineRecordAttachmentAdapter({
  owner: "attempt",
  name: "com.example.transcript",
  versions,
  current: "v1",
  migrations: () => ({}),
  adapt: (transcript, target) =>
    Effect.succeed(
      target.create((blobs) => {
        const body = blobs.add(transcript.body);
        return {
          payload: {
            mediaType: transcript.mediaType,
            body: body.ref,
          },
          blobs: [body] as const,
        };
      }),
    ),
  project: projectTranscript,
});
```

`transcript.body` 是领域 SDK 在 provider boundary 构造的 `RecordBlobSource<BlobE>`。普通 Eval 不处理 blob ref、builder
或 storage path。

target 为本次 adaptation mint ref，并要求 payload projection、显式 draft 列表与捕获 sources 完全相等。missing、
extra、duplicate 或 foreign ref 令 binding 失败并 poison owner。较小 JSON 仍走 `target.value()`，不另建零 blob writer。
