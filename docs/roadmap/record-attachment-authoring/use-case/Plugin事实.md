# Plugin occurrence 的窄写入权

Plugin 复用已有 Eval 或 Experiment lifecycle。它不获得第二套 writer、context、错误词表或 sink；hook 得到的仍是
owner-local `ctx.record()`。

`record-attachments/plugin-observation.ts` 为两种 owner 分别定义事实。

```ts
import { Schema } from "effect";
import { defineRecordAttachment } from "niceeval/record";

export const evalPluginObservation = defineRecordAttachment({
  owner: "attempt",
  name: "com.example.eval-plugin-observation",
  versions: {
    v1: {
      schema: Schema.Struct({ cacheHit: Schema.Boolean }),
      blobRefs: () => [] as const,
    },
  },
  current: "v1",
  migrations: () => ({}),
});

export const experimentPluginObservation = defineRecordAttachment({
  owner: "run",
  name: "com.example.experiment-plugin-observation",
  versions: {
    v1: {
      schema: Schema.Struct({ image: Schema.String }),
      blobRefs: () => [] as const,
    },
  },
  current: "v1",
  migrations: () => ({}),
});
```

每个 linked Plugin occurrence 只取得自己声明的 definition-object。Eval Plugin 写 Attempt，Experiment Plugin 写
Run。

```ts
import { definePlugin } from "niceeval";
import {
  evalPluginObservation,
  experimentPluginObservation,
} from "./record-attachments/plugin-observation.js";

export const cacheProbe = definePlugin({
  name: "cache-probe",
  behaviorRevision: "1",
  recordAttachments: { write: [evalPluginObservation] },
  eval() {
    return {
      async after(ctx) {
        await ctx.record(evalPluginObservation, {
          cacheHit: await readCacheHit(),
        });
      },
    };
  },
});

export const imageProbe = definePlugin({
  name: "image-probe",
  behaviorRevision: "1",
  recordAttachments: { write: [experimentPluginObservation] },
  experiment() {
    return {
      async setup(ctx) {
        await ctx.record(experimentPluginObservation, {
          image: await readImageDigest(),
        });
      },
    };
  },
});
```

挂载点保持原有作者面：

```ts
import {
  defineEval,
  defineExperiment,
  defineSandboxGroup,
} from "niceeval";

defineEval({
  plugins: [cacheProbe()],
});

defineExperiment({
  agent: workerAgent(),
  plugins: [imageProbe()],
});
```

Group 只参与选择与调度。它没有 runtime record context，因此 Group Plugin 不声明
`recordAttachments: { write: [...] }`，也不能调用 `record()`。

```ts
export const cohortTag = definePlugin({
  name: "cohort-tag",
  behaviorRevision: "1",
  group() {
    return { manifest: { strategy: "balanced" } };
  },
});

defineSandboxGroup({ plugins: [cohortTag()] });
```

同一 pair 中，两个 occurrence 请求同一个 owner/name family 是 link conflict。冲突在资源创建前报告；不会因为
instance 不同、payload 相同或其中一个 hook 从未调用而扩张为 owner-wide allowlist。

Plugin 成功写入的 typed event 被 generic writer 接受后，框架才聚合并用私有 builtin grant/context 写
`niceeval.plugin-provenance`。Plugin 不导入该官方 definition，也不把它列进 write grant。应用只安装第三方
family 以读取与迁移：

```ts
import { defineConfig } from "niceeval";
import {
  evalPluginObservation,
  experimentPluginObservation,
} from "./record-attachments/plugin-observation.js";

export default defineConfig({
  recordAttachments: {
    install: [evalPluginObservation, experimentPluginObservation],
  },
});
```

pair link、occurrence identity 与 provenance 的完整约束见 [Plugins](../../plugins/README.md) 和
[Plugin Library](../../plugins/library.md)。
