# 计分制 Attempt 的概览与 attempt.get 不给逐项得分，只能逐条查 detail

## 观察与期望
计分制 Attempt 的终端概览和 `attempt.get` 都列出全部断言条目，但不给每条的结果与得分。`niceeval show @<locator>` 的 Assertion 表只有 label、Entry ID 和 Group 三列；`attempt.get` 的 `assertions.entries[]` 只有 `display` 和 `entryId`。想知道「58/99 的 41 分丢在哪」，只能对每个 entry 调用一次 `attempt.assertion.detail`。

期望：概览（或一个固定 Query operation）能一次给出每条断言的判定结果与 contribution（earned / points / unavailable），让人和脚本能直接看到分数构成，再按需进入单条 detail 读 Judge 理由。

## 公开入口证据
- 项目：NiceEval-Eval，Experiment `install/canary`，Eval `install/db-gpt`，Run `4dd8f8a2-bc1b-4f14-9a86-a4d0343df0c9`，Attempt `@1S65M11H50NXP`，Score 58/99（complete; scored），46 个 entry。
- `niceeval show @1S65M11H50NXP`：Assertion 表只有 `Assertion | Entry ID | Group`，没有结果或分值列。
- `niceeval query run`（`niceeval.query/v3`，`attempt.get`）：`attempt.assertions.entries[]` 只有 `display`、`entryId`。
- 同一 entry 的 `attempt.assertion.detail` 才有 `entry.contribution = {earned, points, state}` 与 `entry.decision.result`。
- 对 4 个安装 Attempt 逐项读取得分，一共 4 次 `attempt.get` 加约 180 次 `attempt.assertion.detail`，本机串行约 8 分钟。

## 影响
计分制题的主要审阅问题是「分数丢在哪、跨版本哪些项变了」。没有逐项得分视图，就看不出评分项是不是在所有 Attempt 上恒为 0。NiceEval-Eval 本次靠逐项 dump 发现了 4 类判据缺陷，这是付费运行之后最常见的读取动作，现在却要 O(N) 次 CLI 调用。

## 环境与来源
2026-10-28，Linux，Node.js 24，pnpm 11.12.0；NiceEval-Eval 通过 `pnpm dev:link` 消费本地核心 `0.0.0-development`（HEAD 6703bfea5）。Record 中的 Attempt 由候选 0.19.1-canary.104 产生。
