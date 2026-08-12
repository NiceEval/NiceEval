# C2：Attempt detail

```ts
async load(analysis) {
  const rows = await analysis.attemptSlots({
    selectedRun: { evaluation: evaluations },
    attempt: {
      assertions,
      verdict,
      score: allowUnavailable(score),
      sourceSites,
    },
    originRun: { sources, evaluation: evaluations },
  });

  return {
    details: attemptDetails(rows),
  };
}
```

`attemptSlots()` 负责 logical alignment。`attemptDetails()` 是普通同步函数，不再接收三条由调用者手工
配对的 entries。

标准 Attempt 页面消费同一个 `model.details`。它没有 private loader、legacy `AttemptEvidence` 或
`evidence(locator)`。缺失的 source field 必须先成为公共 Attachment field。
