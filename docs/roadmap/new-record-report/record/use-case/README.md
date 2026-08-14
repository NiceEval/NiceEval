# NiceEval 内部升级 OTel 事实

本页组合 [Record Library](../library.md) 的接口，展示“内部可定义、外部不可扩展”的完整路径。

## 1. NiceEval 内部升级定义

假设 OTel v2 新增明确的采集限制。拥有该定义的 NiceEval 模块同时提交 current schema（当前格式）与相邻 migration（迁移）：

```ts
const OTelV1 = Schema.Struct({ spans: Schema.Array(SpanV1) });
const OTelV2 = Schema.Struct({
  spans: Schema.Array(SpanV2),
  limitations: Schema.Array(CollectionLimitation),
});

const otelAttachment = defineInternalRecordAttachment({
  id: InternalRecordAttachmentId("niceeval.otel"),
  owner: "attempt",
  cardinality: "one",
  current: { version: 2, schema: OTelV2 },
  limits: otelLimits,
  migrations: [
    defineInternalRecordMigration({
      from: { version: 1, schema: OTelV1 },
      to: { version: 2, schema: OTelV2 },
      migrate: old => ({ spans: upgradeSpans(old.spans), limitations: [] }),
    }),
  ],
});
```

这段接口只存在于 NiceEval 源码内部。项目 package 不能调用它，也不能向 registry（注册表）加入自己的定义。

## 2. Adapter 只提交领域值

Adapter 作者调用稳定的 OTel bridge（可观测性桥接器）：

```ts
otelBridge.emit(span);
```

Attempt 完成时，bridge 内部闭合 batch（批次），再由 runner 拿到的 Capture 写入：

```ts
yield* capture.put(otelAttachment, closeOtelBatch(collectedSpans));
```

Adapter 不知道 attachment ID、版本、schema、owner 或文件布局。Run 封口时，Record 同时验证 OTel、Assertions、file diff（文件差异）和全部 Artifact 引用。

## 3. Analysis 只使用已发布输入

NiceEval 的 Analysis 模块内部把当前 OTel attachment 投影成稳定输入，并从公共 `niceeval/analysis` 导出句柄：

```ts
// NiceEval 内部
const attemptLatencyMs = publishAnalysisInput({
  id: "niceeval.attempt-latency-ms",
  population: logicalSlots,
  attachment: otelAttachment,
  project: payload => payload.spans.map(span => span.durationMs),
});

// Analysis 作者
const meanLatency = defineMeasure({
  id: "project.mean-latency",
  population: logicalSlots,
  input: attemptLatencyMs,
  withinAttempt: sum(),
  withinSlot: latestCompletedAttempt<number>(),
  acrossSlots: mean(),
  denominator: allLogicalSlots(),
  missing: partial(),
  evidence: retainContributingEvidence(),
});
```

Analysis 作者能定义统计口径，但不能看到或选择 `otelAttachment` 的内部字段。

## 4. 逐步迁移

若 root 中存在 v1 OTel attachment，`niceeval migrate` 形成计划。Record maintenance 对每一项依次执行：

```text
decode OTelV1
  → run migration 1→2
  → validate OTelV2
  → validate owner and references
  → stage
```

全部内部 definition 都到达 current version 后，Record 才原子发布新 root。任何一步失败都保留原 root。修复责任属于 NiceEval，不转交给产生 span 的 Adapter package。
