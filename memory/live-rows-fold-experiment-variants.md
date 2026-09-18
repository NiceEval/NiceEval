---
format: concord.document/v1
id: live-rows-fold-experiment-variants
title: live 进度把同 agent 同 model 的实验变体折叠成一行,"0/2" 被误读成同一 eval 跑两次
createdAt: 2026-07-07T20:50:17+08:00
createdAtSource:
  kind: first-recorded
  path: memory/live-rows-fold-experiment-variants.md
  commit: b0447a0a8487cc31fbedcedad3288e37dd40d7c7
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
    statement: '- 已修
      [live-rows-fold-experiment-variants](live-rows-fold-experiment-variants.md)
      — live 进度行 who 曾取 agent/model,同 agent 同 model 的实验变体被折叠成一行,"0/2" 误读成跑两次;修为
      runWho() 有 experimentId 用 basename(`src/runner/types.ts` + attempt.ts +
      cli.ts 同源);同时 resume 复用改为按 experiment 列清单'
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# live 进度把同 agent 同 model 的实验变体折叠成一行,"0/2" 被误读成同一 eval 跑两次

**现象**：`niceeval exp compare`(6 个实验,`runs: 1`)的 TTY live 表里每行计数显示 `0/2`,用户以为每个 eval 要跑两次、质疑"直接 1 次失败就行"。实际没有任何 eval 跑两次。

**根因**：live 行的聚合 key 是 `evalId|who`,而 `who` 曾取 `agent.name/model`。compare 组里 `bub-gpt-5.4` 与 `bub-gpt-5.4--agents-md` 这类变体实验 agent 和 model 完全相同,两个实验的行被折叠成一行,`total` 相加成 2。`src/runner/reporters/live.ts` 里那句"同一 (evalId, who) 可能在多个 agentRun 里出现(不应发生,但做防御)"的假设,被 AGENTS.md 变体实验合法地打破了。

**修法**：`src/runner/types.ts` 新增 `runWho(run)`:有 `experimentId` 用其 basename(唯一,与汇总表口径一致),否则退回 `agent/model`;`src/runner/attempt.ts`(进度上报侧)与 `src/cli.ts`(liveRows 构建侧)都改用它——两处必须同源,否则 progress 消息找不到行。适用判断:凡是用 `agent+model` 当唯一标识的地方,都要想到「同 agent 同 model 的实验变体」这个反例,唯一身份是 `experimentId`。

顺手补了 resume 可观测性:复用上次结果时只报数量不列清单,用户无法核对跳过的是哪些;现按 experiment 分组列出(`runner.resumeCarryDetail`,修在 `src/runner/run.ts`)。
