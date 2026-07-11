---
name: bench-direct-invocation-not-niceeval-project
description: phase-timings.md 的 bench/ 定型为直接调 runAttemptBody 的内部脚本,不是 niceeval 项目 + Reports 报告页
metadata:
  type: project
---

裁决(2026-07-11):`docs/phase-timings.md` 的 `bench/`(装机基准工作台)定型为几个纯 TS 脚本(`run.ts` / `compare.ts` / `stats.ts` / `probes.ts`),直接从 `../src/runner/attempt.ts` 相对导入调用 `runAttemptBody`(单次 attempt 执行引擎),不经过 CLI discover、不落 `.niceeval/result.json`;跑完直接 `console.table` 打印,对比两轮快照走脚本里的 noise-aware 包络判据(效应量阈值 + 历史 min/max 包络),同样直接打印,不生成任何报告页。

**曾选方案(同一场讨论内依次否决)**:

1. bench/ 是一个普通 niceeval 项目(`niceeval.config.ts` + `evals/` + `experiments/`),经 CLI `niceeval exp <provider>` 跑,`report.tsx` 用 [Reports](../docs/reports.md) 积木(`defineReport` + `DeltaTable` 等)聚合展示,快照对比走 `show` 既有的 history/快照对比能力。
2. 折中方案:保留方案 1 的 niceeval-项目形态,只另加一个 `bench/scripts/compare.mjs` 脚本做 noise-aware 对比判据。

**否决理由**:

- 方案 1「对比走 `show`」没有噪声判据:[e2e-ci.md](../docs/e2e-ci.md) 的 `verify.mjs` 已经证明「真实调用的抖动数据不能靠人眼判读 CI 红不红」,专门为「确定性部分精确断言、抖动部分给容忍区间」搭了一层机器判据;bench 面对的 provider/沙箱延迟抖动是同一类问题,方案 1 却退化成人盯着两张快照肉眼比大小,是明显的不对称。
- 方案 1/2 都要求「先跑(`niceeval exp`)再另开一步渲染(`show --report`)」的两段式流程,用户明确要的是「进程内直接调用,类似 `pnpm benchmark` 一条命令直接输出用时」的单命令体验——这条反馈直接否决了 Reports/JSX 路线,不只是否决 `.mjs` 这个文件后缀。
- `compare.mjs` 作为独立脚本仍然违背「bench 应该是仓库内部工具,类似 e2e」的定位——用户纠正后明确要「更贴近 e2e 的‘直接触达内部机制’模式」,而不是外挂一个通用对比工具。
- 调研确认 `runAttemptBody`(`src/runner/attempt.ts`)已经封装了单次 attempt 的完整执行序(沙箱就绪 → hooks → baseline → `eval.setup` → `agent.setup` → tracing → send,含错误处理与超时中断),在 bench 脚本里手搭 `AgentContext`(`session`/`log`/`signal`/`flags`)重新拼一遍风险很高,容易漏字段;`runEvals`/`runAttemptBody` 都没有从包的公开入口导出,但 `bench/` 和 `e2e/` 一样活在仓库内部,可以直接相对导入触达,不需要为此新增公开 API 或导出面。

**How to apply**:落地二期(基准落地)时按这份裁决实现 `bench/`,不要退回「niceeval 项目 + Reports」或「外挂 compare.mjs」这两个已否决的方案;`docs/phase-timings.md` 正文已按此定稿改写,不留时间线痕迹,来龙去脉的出处链到这条。
