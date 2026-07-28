# `AttemptFixPrompt`

`AttemptFixPrompt` 回答「拿什么去修这一次失败」：把单条 attempt 的可行动证据整理成可复制
prompt。它与 [`SampleFixPrompt`](../summaries/sample-fix-prompt.md) 遵守同一边界——措辞与
取舍是产品阅读方式，不是 `.niceeval` 事实——只是在组合层同时读取 snapshot 与需要的证据
Source，全文是：

```tsx
export const AttemptFixPrompt = defineComposition(async (_props, ctx) => {
  const [snapshot, assertions, conversation, diff] = await Promise.all([
    ctx.resolve(sources.attempt.snapshot),
    ctx.resolve(sources.attempt.assertions),
    ctx.resolve(sources.attempt.conversation),
    ctx.resolve(sources.attempt.diff),
  ]);
  const prompt = fixPrompts.attempt(snapshot, assertions, conversation, diff);
  if (prompt === null) return null;

  return <CopyBlock data={{ title: "Fix prompt", text: prompt }} />;
});
```

```tsx
<AttemptFixPrompt />
```

`fixPrompts.attempt` 是 [`fixPrompts` 口径目录](../README.md#口径目录noticesfixprompts)的
attempt 入口，纯函数：

```ts
interface FixPrompts {
  attempt(
    snapshot: AttemptSnapshot,
    assertions: TableContent | null,
    conversation: ConversationContent | null,
    diff: DiffContent | null,
  ): string | null;
}
```

它只消费已经投影好的 Content，不重读 artifact。没有可行动失败（passed 且无丢分）时返回
`null`，区块整块不出现。text 面零输出；终端已有 `--source` / `--execution` / `--diff`
等 evidence 命令作为等价入口。web 面输出单条失败的完整 prompt 与复制增强，呈现遵循
[`CopyBlock`](../primitives/copy-block.md) 原语。

## 相关阅读

- [Attempt 详情](README.md) —— 公开区块集与 page 输入形态。
- [`SampleFixPrompt`](../summaries/sample-fix-prompt.md) —— 整个 Sample 的批量修复 prompt。
- [`CopyBlock`](../primitives/copy-block.md) —— 通用可复制文本 Component。
