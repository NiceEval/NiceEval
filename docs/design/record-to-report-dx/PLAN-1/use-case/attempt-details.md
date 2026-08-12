# C2：展示 Attempt 的 Assertions、Verdict 与 Score

报告要为每个 logical slot 展示 Assertions，并同时显示 execution Verdict、可选 Score 与 origin
Evaluation。作者不分别执行三份 Projection，也不手工按 slot 查找和拼接 entries。

## 声明 aligned query

```ts
const assessment = attemptSlots({
  selectedRun: {
    evaluation: evaluations,
  },
  attempt: {
    assertions,
    verdict,
    score: allowUnavailable(score),
  },
  originRun: {
    evaluation: evaluations,
  },
});
```

`score` property 永远存在并保留 Attachment 六态。`allowUnavailable()` 只表示 Pass Eval 没有 Score
可以是合法结构。若 selected Run Evaluation 表示 Score Eval，但 Score unavailable，领域派生仍把
它报告为 issue。

selected Run Evaluation 决定 not-recorded slot 的题型与 denominator。Included reference 的
origin Run Evaluation 只用于检查原 Attempt 与当前 selected Run 是否仍可比较。

## 形成领域值

```ts
const details = derive({
  data: { assessment },
  completeness: "allow-partial",
  calculate({ data }) {
    return attemptDetails(data.assessment);
  },
});
```

`attemptDetails()` 收到穷尽 rows。它可以为 included + available Assertions 形成详情值，也必须保留：

- excluded、not-recorded 与 core-invalid logical slots；
- unavailable、migration-required、migration-unavailable、unsupported 与 invalid Attachments；
- selected/origin Evaluation 不兼容的 reason；
- 原 denominator 与每个详情值的 logical slot evidence。

这一步取代旧的 `attemptAssertionsData({ assertions, verdict, score })`。调用者不再负责证明三个 entry
属于同一个 slot；alignment 由 `attemptSlots()` 的 row universe 保证。

## 形成详情页

```ts
export default defineReport({
  id: "attempt-details",
  pages: {
    index: page({
      route: "/",
      data: { details },
      render({ data }) {
        return attemptIndexDocument(data.details);
      },
    }),
  },
  families: {
    attempts: pageFamily({
      data: { details },
      instances({ data }) {
        return data.details.items;
      },
      key: ({ slot }) => logicalSlotKey(slot),
      route: ({ slot }) => attemptRoute(slot),
      render({ instance }) {
        return attemptDetailsDocument(instance);
      },
    }),
  },
});
```

Family key 使用 logical slot identity，因此同一个 physical Attempt 被两个 selected Runs 引用时产生两
个页面。确实要按 physical Attempt 合并时，作者改用显式 `physicalAttemptKey()`，并承担展示多个
logical occurrences 的责任。

Family 不能在 instance render 中追加 query。Assertions、Verdict、Score 与 Evaluation 的全部 Record
I/O 在 instances 展开前完成。

## 官方页面没有特权

标准 Attempt 页面使用上面同一份 `assessment` 与 `details` query。它不能从旧
`PageLoadContext.evidence(locator)` 取得一份平行 `AttemptEvidence`，也不能在 package 内部直接打开
Record。`AttemptDetailsInput` 所需的 Assertions、Verdict、Score 与 source 必须来自 public fields
形成的 aligned values。

当标准页面需要一种尚未公开的数据时，产品先为它建立 owner 明确的 RecordAttachment field/query，
再由用户 Report 与 built-in Report 共同消费。空值、legacy evidence 回填和私有读取都不是兼容路径。
