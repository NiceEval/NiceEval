# 写入 blob-backed 事实

完整 transcript 不是 JSON payload。Attachment definition 把 ref 列为 payload 的一部分，并以 `blobRefs()` 声明
它的完整 closure；ref schema 与 source 的构造由 [Library](../library.md) 定义。

`record-attachments/agent-transcript.ts` 导出已定义的 Attempt family：

```ts
import { defineRecordAttachment } from "niceeval/record";
import { transcriptPayloadSchema } from "./transcript-payload-schema.js";

export const agentTranscript = defineRecordAttachment({
  owner: "attempt",
  name: "com.example.agent-transcript",
  versions: {
    v1: {
      schema: transcriptPayloadSchema,
      blobRefs: ({ transcript }) => [transcript] as const,
    },
  },
  current: "v1",
  migrations: () => ({}),
});
```

Eval producer 把 adapter 交回的 opaque source 交给 builder。只有 `blobs.add()` mint 此次 write 的 ref；payload
不含 path、raw bytes 或手写 key。

```ts
import { defineEval } from "niceeval";
import { recordBlobSource } from "niceeval/record";
import { agentTranscript } from "../record-attachments/agent-transcript.js";

export default defineEval({
  recordAttachments: { write: [agentTranscript] },
  async test(ctx) {
    const transcriptSource = recordBlobSource(
      captureTranscriptStream(ctx.agent),
    );

    await ctx.record(agentTranscript, (blobs) => {
      const transcript = blobs.add(transcriptSource);
      return {
        payload: {
          transcript: transcript.ref,
        },
        blobs: [transcript] as const,
      };
    });
  },
});
```

source consumption、closure validation、reservation 与 owner sealing 仍归中立 writer。返回的 `blobs` tuple 让
source failure 类型继续进入同一 command。定义列出一枚 ref 却传入 direct payload、builder mint 的 ref 未被
payload 引用，或 draft 没有逐项列入 `blobs`，都会在该 command 的既定失败语义中结束。

应用只安装 definition 以读取、投影与迁移：

```ts
import { defineConfig } from "niceeval";
import { agentTranscript } from "./record-attachments/agent-transcript.js";

export default defineConfig({
  recordAttachments: { install: [agentTranscript] },
});
```

reader 对 `available` value 提供完整 materialized closure 的只读 snapshot。它不会暴露 blob path、重新开启
source 或授予另一个 owner 写入权；读取用法见 [安装、读取与投影事实](读取投影.md)。
