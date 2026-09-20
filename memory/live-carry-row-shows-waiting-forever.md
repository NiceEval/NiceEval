---
format: concord.document/v1
id: live-carry-row-shows-waiting-forever
title: live-carry-row-shows-waiting-forever
createdAt: 2026-07-11T19:14:39+08:00
createdAtSource:
  kind: first-recorded
  path: memory/live-carry-row-shows-waiting-forever.md
  commit: b4784cd454c29ee194b14f87edda50806470e1b1
description: 已修 — live 表格里被携入(carry)的行永远卡在 waiting for a slot,用户误读成没有复用
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: 已修 — live 表格里被携入(carry)的行永远卡在 waiting for a slot,用户误读成没有复用
    proof: []
    source:
      path: memory/live-carry-row-shows-waiting-forever.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:dddfb3c0d0c0526810d655d69d61e24bc48713475cd592a0aaf380560baa2365
---

## 现象

`niceeval exp <组>`(不带 `--force`)命中 carry(见 [[carry-includes-failed-verdict]])时,表头会正确打出 `reusing N settled results from last run, re-running M evals` 并按 experiment 列出 carried 的 eval id;但下面的实时表格里,这些被携入的 (eval, config) 行**依然显示** `· ... waiting for a slot...`,而且永远不会变化——直到进程结束都停在这个状态。用户看着这一大片"waiting"行,以为"没有直接复用,还是重跑了",但表头统计数字和 `run.ts` 实际调度的 attempt 数其实都是对的,纯粹是展示层的问题。

## 根因

`src/cli.ts` 构建 `liveRows`(供 `LiveReporter` 渲染)时,遍历的是 `evals × agentRuns` 的**全量矩阵**,不知道哪些 `(experimentId, evalId)` 会被携入——carry 的判断(`planCarry`,原来是 `run.ts` 内联的一段逻辑)在那之后才发生,发生在 `runEvals()` 内部。而 `LiveReporter` 的行状态机里,一行要从"等待"变成"完成"只有一条路:收到 `eval:start` 事件(`state.started = true`)+ 之后的 `eval:complete`。携入的 eval 根本不会被 `run.ts` 派发成 attempt(`priorRunKeys.has(...)` 直接 `continue` 跳过整个调度),所以这两个事件永远不会为它触发——这一行从渲染逻辑角度看,是个"注定等不到任何更新"的僵尸行。

## 修法

把 carry 的判断逻辑从 `run.ts` 内联代码提成 `src/runner/fingerprint.ts` 的 `planCarry(evals, agentRuns, priorResults)`,`cli.ts` 在构建 `liveRows` **之前**先调用一次(顺带把 `priorResults` 的加载也从原来靠后的位置挪到这里),`run.ts` 内部改成优先用 `opts.carryPlan`(cli.ts 传入)、没有才自己算一遍(直调 `runEvals` 的测试场景兜底)——两处必须共用同一份判断,不能各自实现,否则又会重演 [[live-rows-fold-experiment-variants]] 那种"两处口径不同源"的坑。

`LiveRow` 新增可选字段 `carriedVerdict`;`cli.ts` 按 `carryPlan.priorRunKeys` 命中的行直接带上真实 verdict(`passed`/`failed`)。`live.ts` 的 `Live()` 构造函数里,`carriedVerdict` 非空的行从第一帧起就初始化成 `completed = total`、`started = true`、`dominantVerdict = carriedVerdict`,`renderRow` 因此直接走"已完成"分支渲染出真实的 ✓/✗ 符号,不再经过 waiting/spinner。同时把这部分 `total` 计入 `totalCompleted` 的初值,让表头 "X/Y done" 从第一帧起就是准确的(而不是从 0 起跳,过一会儿又莫名跳涨一截)。

补了 `src/runner/reporters/live.test.ts` 覆盖:携入行第一帧就渲染真实 verdict 且不含 "waiting"字样,未携入行仍正常显示 waiting。

## 适用场景

任何"表格/进度展示层需要提前知道调度层的某个决策"的地方,都要警惕两者各自实现同一份判断逻辑的重复——判断本身可能一致,但只要有一处漏改、或计算依据(如本例的 `priorResults` 加载时机)不同步,就会出现"底层数据是对的,展示层却撒谎"的静默 bug,比调度真的错了更难发现(因为退出码、汇总统计全部正确)。
