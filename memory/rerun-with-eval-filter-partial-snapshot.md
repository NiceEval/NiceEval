# 带 eval-id 位置参数补跑会产出部分快照,遮蔽线上/聚合口径

## 现象

实验里个别 eval errored(如 e2b 瞬时 fetch failed),用 `niceeval exp <实验> <eval-id…>` 只补跑那几道题。补跑本身成功,但新 run 的 summary 只含补跑的 1-2 个 eval;任何按 `latestPerExperiment`(每实验最新快照)聚合的消费方——包括 coding-agent-memory-evals 的线上站——都会用这份部分快照**遮蔽**之前的全量快照,榜单从 5/6 变成 1/2 这种误导数字。选择器会诚实地报 `covers 2 of 6 evals seen in history` warning,但不会拒绝。

复现:coding-agent-memory-evals 2026-07-07 的 agents-md 变体,10-09/10-15 两个补跑 run 各只含 2/1 个 eval,线上 bub--agents-md 显示 1/2、codex--agents-md 显示 0/1。

## 根因

carry(resume)机制的作用域是「本次计划内的 eval」:`src/runner/run.ts` 只把上次 passed/failed 且 fingerprint 命中 `plannedFingerprints` 的结果携入(2026-07-11 起 failed 也算终态,见 [[carry-includes-failed-verdict]]),而位置参数在 CLI 层就把 `opts.evals` 裁成了补跑那几道——计划外的结果根本不进 fingerprint 表,携带被整体绕过。这与 CLI Model 一致(位置参数=「跑哪些」),但和用户对「补跑」的期待(合并出完整结果)相反。

## 修法

- **正确补跑姿势:不带位置参数重跑整个实验或整个组**:`niceeval exp <实验|组>`(不加 `--force`)。上次 passed/failed 且 fingerprint 匹配的 eval 零成本携入,只有 errored/缺失真跑,产出完整快照,线上口径自动恢复。
- 带位置参数补跑只适合「本地快速验证某道题」,其结果不该被当作实验的最新快照发布。
- **已修(第二层根因)**:carry 基线原来只取「最近一个 run」(`loadMostRecentResults` 的 `loaded[0]`),部分补跑 run 一旦成为最新,任何后续续跑都携带不到东西,`exp <组>` 补齐随之失效。已改为跨历史每 `(experimentId, evalId)` 取最新一份(`src/view/loader.ts` 的 `loadLatestResultsPerEval`,配套 `loader.test.ts`)。
- 设计层面待议:carry 是否应无视位置参数、把计划外的 prior passed 也携入 summary(「跑哪些」与「报什么」分离)。若做,需在 docs/cli.md 与 view/reports 口径一并声明。

## 回归 kill 收据

`85cafd7d` 的 fix parent 只读取最新一个 Run。先产生含 alpha、beta 的完整 Run，再用 eval selector 只补跑 alpha，
随后对完整 Experiment 做 dry：旧实现只能看见最新部分 Run，beta 被判为不可携入；修复实现会分别从部分 Run 取 alpha、
从更早完整 Run 取 beta。修复提交的 `src/view/loader.test.ts` 已用这组两层历史证明旧算法与新算法的差异。

目标 E2E owner 是 `docs/roadmap/testing/example/repos/runner/test/carry-reuse.test.ts`。它必须真的执行
`full → 带 eval selector 的 partial → full dry/run`，并在 full dry 处断言 alpha、beta 都携入；若第二步只是再次运行完整
Experiment，就杀不死旧实现，也没有资格写 `regression:`。
