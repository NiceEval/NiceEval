# C2：Attempt detail

```ts
const details = model.logicalSlots
  .query()
  .join(model.includedAttempts)
  .join(model.originRuns)
  .select({
    selectedEvaluation: fields.selectedRun.evaluation,
    assertions: fields.attempt.assertions,
    verdict: fields.attempt.verdict,
    score: fields.attempt.score.allowUnavailable(),
    sourceSites: fields.attempt.sourceSites,
    originSources: fields.originRun.sources,
    originEvaluation: fields.originRun.evaluation,
  });
```

Relation edges 对齐所有字段。Not-recorded、excluded 与 core-invalid rows 仍在 population 中，Attempt 与
origin Run fields 对这些 rows 标记为 relation-unreachable，而不是伪造 unavailable Attachment。

```ts
pageFamily({
  data: { details },
  instances: ({ data }) => assertionInstances(data.details),
  key: ({ slot, assertion }) =>
    logicalAssertionKey(slot, assertion.entryId),
  route: ({ slot, assertion }) =>
    assertionRoute(slot, assertion.entryId),
  render: ({ instance }) => assertionDocument(instance),
});
```

标准页面使用相同 Query 与 relation fields。若 source-sites 尚无 public Field，官方页面同样不能读取。
