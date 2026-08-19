# 共享 Sandbox 构建失败

Sandbox 构建在 Attempt 创建前失败时，Human 摘要说明哪些 Attempt 没有启动，展示真实错误，并引导查看所属 Run：

```text
╭─ ERRORED ─────────────────────────────────────────────────────── 7s ─╮
│ 0 scored · 0 skipped · 18 errored  (0 reused)                       │
╰──────────────────────────────────────────────────────────────────────╯

╭─ ERRORS ─────────────────────────────────── 18 attempts not started ─╮
│ ✗ install/canary · Sandbox image build failed                      │
│   affected: install/db-gpt, install/gpt-researcher, …                │
│   error: Docker daemon unavailable: /var/run/docker.sock does not    │
│     exist or the selected Docker context cannot reach it.            │
╰──────────────────────────────────────────────────────────────────────╯

╭─ NEXT ───────────────────────────────────────────────────────────────╮
│ install/canary                                                      │
│   details: niceeval show --run                                       │
│     8f3d6f62-1d34-4cf3-99c7-84ba3c483706                             │
╰──────────────────────────────────────────────────────────────────────╯
```

原始错误即使只有一个长行，也按 panel 显示宽度折行，不能在关键信息出现前截断。Human 不展示内部 failure ID、
phase key 或 BuildKey，也不添加 `cause:` 和猜测性的 `fix:`。这类失败没有 Attempt locator；Run 正式进入
receipt 后，`NEXT` 才按 run configuration 给出 `show --run`，不显示虚构的 `show @…`。完整语义见
[CLI · 结束反馈与 receipt](../cli.md#结束反馈与-receipt)。
