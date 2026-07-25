# `AttemptList`

每项显示一次 attempt 的判定、单行结果摘要（`failureSummary`）、`examScore` 和 locator。[内建报告的 Attempts 页](../../library/built-in.md)就是 `<AttemptList filter />`。完整 assertions（含 judge 的 evidence）、diagnostics、cause 与 stack 不进 `AttemptListItem`——列表 data 只携带按 [Scoring display 契约](../../../scoring/library/display.md#主失败断言怎样选)算好的摘要；需要完整结构时经 locator 回读取面（[`resolveLocator`](../../../record/library.md#按-locator-寻址一个-attemptresolvelocator) → `AttemptHandle`），列表 JSON 因此不会携带 stack、evidence 或自由文本证据。最常见的失败清单有成品 [`FailureList`](failure-list.md)；`AttemptList` 服务其余自选集合。数据形状见[实体列表](README.md#数据形状)。

```tsx
const all = await attemptListData(ctx.sample);
const failed = all.filter((x) => x.verdict === "failed" || x.verdict === "errored");

<AttemptList data={failed.slice(0, 20)} total={failed.length} />
```

## 相关阅读

- [实体列表](README.md) —— 数据形状与时效标注。
- [`ExperimentList`](experiment-list.md) / [`EvalList`](eval-list.md) / [`FailureList`](failure-list.md) —— 其它实体列表。
