# `SampleFixPrompt`

`SampleFixPrompt` 把当前 Sample 中可行动的失败整理成可复制 prompt。它是组合组件，不是 Source：
“选择哪些失败、怎样措辞、给 coding agent 哪些下一步”属于产品阅读方式，不是 `.niceeval` 事实。

```tsx
export const SampleFixPrompt = defineComposition(async (_props, ctx) => {
  const attempts = await sources.entity.attempts.compute(ctx.sample);
  const failures = attempts.rows.filter(isActionableFailure);
  if (failures.length === 0) return null;

  return <CopyBlock data={{ title: "Fix prompt", text: buildFixPrompt(failures) }} />;
});
```

`buildFixPrompt()` 是纯函数，只消费已经投影好的 locator、eval id 与失败摘要，不重读 artifact。
text 面零输出；终端已有 `niceeval show @<locator>` 作为等价入口。web 面输出完整 prompt 与复制增强。

单次 Attempt 的 `AttemptFixPrompt` 遵守同一边界，只是在组合层同时读取 snapshot 与需要的证据 Source。

## 相关阅读

- [`CopyBlock`](../primitives/copy-block.md) —— 通用可复制文本 Component。
- [Attempt 详情](../attempt-detail/README.md) —— `AttemptFixPrompt` 的装配位置。
