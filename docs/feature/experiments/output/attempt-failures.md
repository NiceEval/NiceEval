# Attempt 失败：每条错误用 locator 下钻

断言不通过可以按共同形态聚合。execution error 则逐 Attempt 展示安全封口后的 Provider message；即使 phase 和
code 相同，不同 message 也不能被代表项吞掉。每条 execution error 同时给出自己的 locator 下钻命令：

```text
╭─ FAILED ─────────────────────────────────────────────────────── 41s ─╮
│ 0 passed · 0 failed · 2 errored  (0 reused)                         │
╰──────────────────────────────────────────────────────────────────────╯

╭─ FAILURES ────────────────────────────────────── 2 errored attempts ─╮
│ ✗ @1K1P0VJAPVJ12  provider-errors/e2b  [fixture]                    │
│   error: 401 Unauthorized — Invalid API key                          │
│   details: niceeval view @1K1P0VJAPVJ12                              │
│ ✗ @1MEMY3VCQ6B5B  provider-errors/vercel  [fixture]                 │
│   error: 403 Forbidden — Team access is required                     │
│   details: niceeval view @1MEMY3VCQ6B5B                              │
╰──────────────────────────────────────────────────────────────────────╯
```

`error:` 是 typed Provider error 的 `message` 经既有敏感值脱敏、控制字符剥除和单条预算收口后的文本；
`cause` 不回退进 Human。文本在进入 panel 前折行。完整错误、阶段和执行证据由对应 `view @<locator>` 读取。
完整语义见
[CLI · 结束反馈与 receipt](../cli.md#结束反馈与-receipt)。
