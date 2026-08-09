# Attempt fix prompt

`attemptFixPrompt(details)` 是对 plan 已交付 `AttemptDetailsData` 的纯转换：

```ts
function attemptFixPrompt(
  details: AttemptDetailsData,
): CopyBlockContent | null;
```

`AttemptDetailsData` 的唯一 owner 是[详情入口](README.md#输入)，`CopyBlockContent` 的唯一 owner 是
[`CopyBlock`](../primitives/copy-block.md#形状)。函数只能读取 `details.attempt`、membership 与已经存在的
section EvidenceValue；它不打开 Record、不接 AttemptHandle、不调用 Projector，也不按 section id
追加证据读取。

只有已交付 evidence 明确证明没有可行动失败时才返回 `null`。unavailable section 仍由详情区块原样
显示其 causes / basedOn，不能被 `attemptFixPrompt()` 解释成空 Attempt。`CopyBlock` 只负责显示与复制。
