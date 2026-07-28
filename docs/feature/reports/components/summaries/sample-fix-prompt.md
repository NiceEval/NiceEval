# `SampleFixPrompt`

`SampleFixPrompt` 把当前 Sample 中可行动的失败整理成可复制 prompt，回答「拿什么去修这批失败」。
它是组合组件，不是 Source：“选择哪些失败、怎样措辞、给 coding agent 哪些下一步”属于产品阅读方式，
不是 `.niceeval` 事实。全文是：

```tsx
export const SampleFixPrompt = defineComposition(async (_props, ctx) => {
  const attempts = await ctx.resolve(sources.entity.attempts);
  const prompt = fixPrompts.sample(attempts.rows);
  if (prompt === null) return null;

  return <CopyBlock data={{ title: "Fix prompt", text: prompt }} />;
});
```

```tsx
<SampleFixPrompt />
```

`fixPrompts.sample` 是 [`fixPrompts` 口径目录](../README.md#口径目录noticesfixprompts)的
Sample 入口，纯函数：

```ts
interface FixPrompts {
  sample(rows: readonly AttemptRow[]): string | null;
}
```

筛选与措辞都在入口内完成：它从行里挑出可行动的失败（failed / errored，占位行与历史噪声
不进 prompt），只消费已经投影好的 locator、eval id 与失败摘要，不重读 artifact；没有可行动
失败时返回 `null`，区块整块不出现。要别的筛选口径（只看某个 agent、按成本排序），自己写
[组合组件](../../library/layout.md#自定义组件)加工行数据并生成自己的 prompt 文本。

text 面零输出；终端已有 `niceeval show @<locator>` 作为等价入口。web 面输出完整 prompt 与
复制增强，呈现遵循 [`CopyBlock`](../primitives/copy-block.md) 原语。

单次 Attempt 的 [`AttemptFixPrompt`](../attempt-detail/attempt-fix-prompt.md) 遵守同一边界，
只是在组合层同时读取 snapshot 与需要的证据 Source。

## 相关阅读

- [`CopyBlock`](../primitives/copy-block.md) —— 通用可复制文本 Component。
- [`AttemptFixPrompt`](../attempt-detail/attempt-fix-prompt.md) —— 单条 attempt 的修复 prompt。
- [实体数据源](../sources/entity.md) —— `sources.entity.attempts` 的行形状。
