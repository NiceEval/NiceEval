# OTel 与 Assertions 怎样进入同一 Attempt relation

## 物理现场

一个 Attempt 有七份相关 owner-local packages：

```text
attempt/<AttemptId>/attachments/
├─ niceeval.agent-events/...
├─ niceeval.otel/...
├─ niceeval.commands/...
├─ niceeval.assertions/...
├─ niceeval.verdict/...
├─ niceeval.score/...             仅 Score Eval
└─ niceeval.capture-receipt/...
```

OTel package 保存 span `span_01`、operation `op_01` 与 send anchor `send_01`。Agent events package 保存
同一个 `send_01` 对应的 user/assistant/tool events。Assertions package 的 `assertion_01` 显式引用
`send_01`；Verdict package 的 evidence 引用 `assertion_01`。Capture Receipt 声明本 Attempt 使用
`physical-v1`，OTel 与 agent-events 的 expectation 都是 sealed。

## Projection

声明阶段先闭合 Receipt、physical 与 legacy 三条有限分支：

```ts
const attemptCaptureReceiptProjection = definePackageProjection({
  access: packages.captureReceipt,
  projector: captureReceiptProjector,
});

const attemptObservabilityProjection = defineRepresentationProjection({
  receipt: attemptCaptureReceiptProjection,
  physical: {
    "agent-events": definePackageProjection({
      access: packages.agentEvents,
      projector: agentEventProjector,
    }),
    otel: definePackageProjection({ access: packages.otel, projector: otelProjector }),
    timing: attemptTimingProjection,
    diagnostics: attemptDiagnosticsProjection,
  },
  legacy: {
    conversation: legacyConversationProjection,
    usage: legacyUsageProjection,
    timing: legacyTimingProjection,
    diagnostics: legacyDiagnosticsProjection,
  },
});
```

这一步不执行 I/O，也不允许 callback 临时增加 family。绑定 Sample 后才执行：

```ts
const observability = yield* sample.projectRepresentation(attemptObservabilityProjection);
const commands = yield* sample.projectPackage(packages.commands, commandProjector);
const assertions = yield* sample.projectPackage(packages.assertions, assertionProjector);
const verdict = yield* sample.projectPackage(packages.verdict, verdictProjector);
```

`projectRepresentation()` 返回与 Sample logical slots 对齐的 `ProjectedRepresentationSet`。
每个 owner 只激活 physical 或 legacy 一支，但分支内的每个 projector 仍只验证和解释一包。
Legacy usage 与 timing 不被伪装成一个 family。OTel projector 可从同一 OTel package 形成 spans、
usage 与 timing local views，但看不到 Assertions。

## Relation

```ts
const related = yield* sample.relations.build(attemptFactRelations(), {
  observability,
  commands,
  assertions,
  verdict,
});
```

Relations 由 anchors 形成：

```text
logical slot → exact Attempt
                  ├─ send_01 → agent events
                  ├─ send_01 → op_01 → span_01
                  └─ assertion_01 → Verdict evidence
```

如果 OTel package 没有引用 `send_01`，`send → OTel operations` 的 `many` edge 返回
matched-empty。若 package 另有没有 send anchor 的 `op_01`，该 orphan operation 返回 unmatched。
Agent events 与 Assertions 仍各自有效。系统不找“时间最接近 assertion 的 span”补值，也不把
usage 变成零。

## Report

Attempt 页面和 cost metric 消费同一 relations：

```ts
const details = derive({
  from: { related },
  compute: attemptDetails,
});

const cost = derive({
  from: { usage: related.usage },
  compute: (input) => observedCost(input, {
    reconcile: exactAgreement,
    onConflict: "unavailable",
  }),
});
```

官方页面没有 private OTel reader。若 public relation 无法提供某个字段，官方同样显示 unmatched/partial，
而不是回读 package path 或 legacy evidence。
