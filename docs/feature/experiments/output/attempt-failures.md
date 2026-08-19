# Attempt 失败：用 locator 下钻

Attempt 已经创建时，结束摘要说明失败处于哪条 Eval、哪个阶段和哪种稳定形态。每个单独展开的 Attempt 同时给出 locator 下钻命令：

```text
╭─ FAILED ─────────────────────────────────────────────────────── 41s ─╮
│ 0 passed · 2 failed · 0 errored  (0 reused)                         │
╰──────────────────────────────────────────────────────────────────────╯

╭─ FAILURES ───────────────────────────────────── 2 total · 2 kinds ─╮
│ ✗ @1K1P0VJAPVJ12  memory/commit0  [codex · gpt-5.6]                 │
│   expected command to succeed                                       │
│   Inspect: niceeval show @1K1P0VJAPVJ12                              │
│ ✗ @1MEMY3VCQ6B5B  memory/commit1  [codex · gpt-5.6]                 │
│   expected file README.md to contain "Install"                       │
│   Inspect: niceeval show @1MEMY3VCQ6B5B                              │
╰──────────────────────────────────────────────────────────────────────╯
```

多条 Attempt 具有相同失败形态时，摘要可以合并为 `×N` 并只给代表 locator。代表 locator 只解释一条 Attempt，
不能替整组声明具体 message 或 received；`NEXT` 中每个 `show --run` 会列出该 Run 的全部 locator，用户再用
`niceeval show @<locator>` 查看各自证据，需要运行轨迹时追加 `--execution`。完整语义见
[CLI · 结束反馈与 receipt](../cli.md#结束反馈与-receipt)。
