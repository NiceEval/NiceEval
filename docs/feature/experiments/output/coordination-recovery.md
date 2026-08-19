# 协调状态恢复

当前 Invocation 接管过期协调状态时，首条恢复立即展开，后续同类事件在结束面板汇总：

```text
i coordination-recovered
  recovered expired coordination state for compare/codex; this run continues. Further recoveries are summarized at completion.

╭─ RECOVERY ───────────────────────────────────────────────────────────╮
│ i coordination-recovered  3 concurrency slots · 18 case locks       │
╰──────────────────────────────────────────────────────────────────────╯
```

恢复成功不会把 Invocation 判为 warning 或 failure。完整语义见
[CLI · 协调等待与恢复](../cli.md#协调等待与恢复)。
