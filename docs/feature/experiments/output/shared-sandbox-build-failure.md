# 共享 Sandbox 构建失败

同一个 BuildKey 的 Docker 构建在 Attempt 创建前失败时，依赖它的 slot 共用一条 failure。`n1` 只在所属 Run 内关联这次物理失败，不表示错误类别。摘要先展示可执行根因，再展示可省略的命令：

```text
╭─ ERRORED ─────────────────────────────────────────────────────── 7s ─╮
│ 0 scored · 0 skipped · 18 errored  (0 reused)                       │
╰──────────────────────────────────────────────────────────────────────╯

╭─ ERRORS ───────────────────────────────────────────────── 18 slots ─╮
│ ✗ install/canary · sandbox provisioning failed                      │
│   run: 8f3d6f62-1d34-4cf3-99c7-84ba3c483706                         │
│   phase: sandbox.image.build                                        │
│   affected: install/db-gpt, install/gpt-researcher, …                │
│   shared failure: n1                                                │
│   sandbox-build-failed                                              │
│   cause: Docker daemon unavailable: /var/run/docker.sock does not    │
│     exist or the selected Docker context cannot reach it.            │
│   command: docker build … --target candidate …                       │
│   fix: Start Docker or select a working Docker context; verify with  │
│     docker info.                                                     │
│   Inspect: niceeval show --run                                       │
│     8f3d6f62-1d34-4cf3-99c7-84ba3c483706                             │
╰──────────────────────────────────────────────────────────────────────╯
```

原始 stderr 即使只有一个长行，`cause:` 和 `fix:` 也按 panel 显示宽度折行，不能在根因出现前截断。
无法安全分类时省略 `fix:`，保留有界 `cause:` 和下钻命令。另一个 Run 即使也产生 `n1`，仍是另一组，
可以具有不同的 `cause:`。这类失败没有 Attempt locator，因此只引导 `show --run`，不显示虚构的 `show @…`。完整语义见
[CLI · 结束反馈与 receipt](../cli.md#结束反馈与-receipt)。
