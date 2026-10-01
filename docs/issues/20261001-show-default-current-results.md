---
format: concord.document/v1
id: 20261001-show-default-current-results
title: 默认 niceeval show 没有按契约读取当前目标 project.get
createdAt: 2026-10-01T02:45:51.950Z
kind: issue
state: closed
memoryRelations: []
adoptions:
  current: []
  history: []
closure:
  kind: closed
  reason: 已修复：134eca614。默认 show 改用 project.get，显示 Current results、Covered、Gaps、缺口原因与 Next；--record 显示 Recorded results；--dry 与 project.get 共用同一判断。沙箱外验证：pnpm typecheck、相关单元测试 52/52、inspection E2E（show-cli、inspection-query）6/6 通过。
history:
  - at: 2026-10-01T07:12:05.003Z
    action: close
    reason: 已修复：134eca614。默认 show 改用 project.get，显示 Current results、Covered、Gaps、缺口原因与 Next；--record 显示 Recorded results；--dry 与 project.get 共用同一判断。沙箱外验证：pnpm typecheck、相关单元测试 52/52、inspection E2E（show-cli、inspection-query）6/6 通过。
---

## 观察

在只有 `package.json` 和空 `evals/` 的项目里运行默认 `niceeval show`，实际输出：

```text
NiceEval results
  Totals

  Observed   0/0
  Verdicts   0 passed
  Pass rate  empty
  Duration   unavailable
  Tokens     unavailable
```

`packages/niceeval/src/show/contribution.ts` 的默认路径调用 `overview.get`。`packages/niceeval/src` 里没有任何 `project.get` 实现。

## 期望

`docs/feature/inspection/cli.md`「当前 Results」与「固定投影」规定：不带 selector 的 `show` 调用 `project.get`，标题为 `Current results`，先显示 `Covered N/M` 与 `Gaps K`，缺口带原因、旧 locator 和下一步；不用 `Observed` 暗示当前结果可用性。`Recorded results` / `overview.get` 只用于显式 `--record`。

## 影响

用户改了判据或新增评估用例后，默认 `show` 仍按历史发布数量汇总，看不到当前缺口，也拿不到 `exp --dry` 这类下一步。公开教程按真实输出写示例，与契约不一致。

## 复现

1. 新建只含 `package.json` 与空 `evals/` 的目录。
2. 运行 `niceeval show`。

## 来源

Agent 辅助的直接使用：重写中文公开文档时对照契约与 CLI 实际输出发现。HEAD `a12be6534`，Linux，Node v24.19.0。
