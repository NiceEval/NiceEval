---
format: concord.document/v1
id: cli-usage-errors-go-to-stderr
title: cli-usage-errors-go-to-stderr
createdAt: 2026-07-22T08:08:25+08:00
createdAtSource:
  kind: first-recorded
  path: memory/cli-usage-errors-go-to-stderr.md
  commit: 4de42b0162238fb9d0583f6df47d8bca1f2d732d
description: niceeval CLI 的用法错误/无匹配提示（page not found、No results matched、--exp 无匹配等）一律写 stderr，不是 stdout
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---

**现象**：写 E2E `verify-*.ts` 时用 `spawnSync` 分别拿到 `stdout`/`stderr`，对预期
失败的命令（如 `show --page bogus`、`show <无匹配前缀>`、`show --exp <无效前缀>`）只
断言 `res.stdout.includes(...)` 会稳定失败——`stdout` 是空字符串，消息全部在
`stderr`。手动用 `... 2>&1` 合并输出调试时看不出这个区分（合并后两者都在同一段文本
里），只有分别读两个流才会暴露。

**根因**：`src/cli.ts` 把用法错误、无匹配报告这类"命令没有正常完成"的反馈统一写
`process.stderr`，只有命令**正常完成**时的报告/榜单内容才写 `process.stdout`——这是
一贯的 Unix 惯例（诊断信息走 stderr），但 `docs/engineering/testing/e2e/verification.md`
的示例代码没有专门强调这一点，容易被跳过。

**修法**：给预期失败的命令写断言时，检查 `stdout + "\n" + stderr` 的合并文本（或者
明确只查 `stderr`），不要只查 `stdout`。已应用在 `e2e/report/scripts/verify-readback.ts`
的 `shRaw()` 辅助函数（返回 `{stdout, stderr, combined, status}` 四个字段）。后续
`e2e/cli`、B3/B4/B5 等新增验收脚本如果也要断言 usage-error 文案，直接复用这个模式。
