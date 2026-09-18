---
format: concord.document/v1
id: live-dashboard-active-row-elapsed-resets-per-phase
title: live 面板 ACTIVE 行:时间列按 phase 计时,过阶段边界归零
createdAt: 2026-07-24T22:11:11+08:00
createdAtSource:
  kind: first-recorded
  path: memory/live-dashboard-active-row-elapsed-resets-per-phase.md
  commit: 2edc8e1a2ecb34b535bc7ea58f9650d94c86ca13
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [live-dashboard-active-row-elapsed-resets-per-phase](live-dashboard-activ\
      e-row-elapsed-resets-per-phase.md) — ACTIVE 行时间列按当前 phase 计时,`eval.run`
      跑几分钟后进 `workspace.diff` 回归 0s,读起来像这条 eval 重跑了,还与 cli.md「存活性由持续增长的 elapsed
      证明」自相矛盾;修为 `ActiveAttempt.startedAt` 只在 `attempt:start`
      写一次、阶段推进只换标签,阶段耗时不进 live 面板(归 `timing.phases`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# live 面板 ACTIVE 行:时间列按 phase 计时,过阶段边界归零

## 现象

`niceeval exp compare/codex-gpt-5.6-luna--nowledge` 跑了 20 分钟,用户看到某条 ACTIVE 行的时间列**从几分钟回归 0 重新计时**,行尾文字同时整段换掉,读起来像这条 eval 重跑了:

```
● react-hook-form/pr-13603  codex-…--nowledge  3m 39s  running eval: tool: /bin/bash -lc "git show …
                        ↓ 几分钟后
● react-hook-form/pr-13603  codex-…--nowledge      0s  capturing diff
```

2026-07-24 用户在 MemoryBench 真机复现(30 题 compare 矩阵,E2B 沙箱)。

## 根因

`ActiveAttempt` 只存了「进入当前 phase 的时刻」,**没有 attempt 起点**,时间列于是渲染的是当前阶段耗时:

- `src/runner/types.ts` `ActiveAttempt.phaseStartedAt` —— 唯一的时间基准
- `src/runner/feedback/reducer.ts` `attempt:phase` 分支 —— 每条阶段事件都把它重置为 `event.at`
- `src/runner/feedback/human.ts` `formatActiveRow()` —— `now() - phaseStartedAt`

真实阶段链(取自 result.json 的 `timing.phases`,react-hook-form/pr-13603)是
`sandbox.queue 0s → sandbox.create 1s → telemetry.configure 1s → sandbox.setup 4s → workspace.baseline 0s →
agent.setup 6s → telemetry.configure 0s → eval.run 357s → workspace.diff 0s → scoring.evaluate 0s →
telemetry.collect 2s → teardown`。所以肉眼可见两类归零:开头 20 秒内连跳六次,以及 `eval.run` 几分钟后掉进
`workspace.diff` 的 0s。`attempt:phase` 同时清空 `detail`(那条是对的),两件事叠在一起,行看上去像换了一条 attempt。

排除掉的相邻嫌疑(都查过,不是成因):`eval.run` 一个 attempt 只进入一次(`attempt.ts` 的 `enterPhase` 调用点,落盘
phases 里也只出现一次);`agent.run` 只作归因值,不发 `attempt:phase`(`timing.ts` 显式 return);`attempt:start`
严格一 attempt 一次(`run.ts` 的调用点注释)。所以不是重试、也不是事件重发。

**这不是观感问题,是与自身规格矛盾**:cli.md 三处(judge 预检行、锁等待行、刷新节流)都写着「不做 spinner 动画,
**存活性由持续增长的 elapsed 证明**」。会归零的列证明不了存活。字段注释("用于渲染阶段耗时")说明当初是有意按阶段
计时的,只是那次选择和后来写进 cli.md 的存活性契约没对齐——同一个语义没有单一出处,是这类 bug 的常见形状。

## 修法(已修)

`ActiveAttempt.phaseStartedAt` → `startedAt`,只在 `attempt:start` 写一次,`attempt:phase` 原样带过去(spread 保留),
时间列改渲染 attempt 耗时。**阶段耗时不在 live 面板露出**:`eval.run` 是主阶段,attempt 耗时与它只差二十秒的预置段,
两个时钟并排是重复信息;要看逐阶段耗时的场合是事后,`timing.phases` 已完整落盘,`niceeval show @<locator> --timing` 读。
这样 `ActiveAttempt` 也不留没人读的字段。

- `src/runner/types.ts`:字段改名并把「时间列是存活性的唯一证明、`attempt:phase` 不得改写」写进 TSDoc
- `src/runner/feedback/reducer.ts`:`attempt:start` 写 `startedAt`;`attempt:phase` 只换 `phase`/清 `detail`
- `src/runner/feedback/human.ts` `formatActiveRow()`:`now() - active.startedAt`
- `docs/feature/experiments/cli.md`:「Attempt 阶段」补一段(阶段推进只换标签不重置时钟、阶段耗时归 `timing.phases`),
  「active 行的列序」那条补上 `elapsed` 的起算点

回归测试(先在 HEAD 上验过必挂,再验修后必过):`src/runner/feedback/reducer.test.ts`「phase 变化不重置 startedAt」
走四段阶段推进逐段断言基准不动;`src/runner/feedback/human.test.ts`「时间列从 attempt 派发起算」按真实时长
(262s 的 `eval.run` → `workspace.diff`)断言第二帧是 `4m 23s  capturing diff` 而不是 `0s`。
