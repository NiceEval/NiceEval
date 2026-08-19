# debug：多行 Shell

多行 Shell 使用固定 gutter，不把脚本压成带 `\n` 的单行字符串：

```text
╭─ sandbox.prepare ──────────────────────────────────────────────────── EXACT ─╮
│ position: lane eval:group/first · slot group/first #0                        │
│ owner: eval:group/first                                                      │
│ command: shell · 5 lines                                                     │
│   │ set -eu                                                                  │
│   │   pnpm install                                                           │
│   │                                                                          │
│   │   pnpm test                                                              │
│   │                                                                          │
╰──────────────────────────────────────────────────────────────────────────────╯
```

空行、缩进和末尾换行都是被展示的命令事实。完整语义见
[CLI · `debug`](../cli.md#debug)。
