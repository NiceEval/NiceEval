# live 进度把同 agent 同 model 的实验变体折叠成一行,"0/2" 被误读成同一 eval 跑两次

**现象**：`niceeval exp compare`(6 个实验,`runs: 1`)的 TTY live 表里每行计数显示 `0/2`,用户以为每个 eval 要跑两次、质疑"直接 1 次失败就行"。实际没有任何 eval 跑两次。

**根因**：live 行的聚合 key 是 `evalId|who`,而 `who` 曾取 `agent.name/model`。compare 组里 `bub-gpt-5.4` 与 `bub-gpt-5.4--agents-md` 这类变体实验 agent 和 model 完全相同,两个实验的行被折叠成一行,`total` 相加成 2。`src/runner/reporters/live.ts` 里那句"同一 (evalId, who) 可能在多个 agentRun 里出现(不应发生,但做防御)"的假设,被 AGENTS.md 变体实验合法地打破了。

**修法**：`src/runner/types.ts` 新增 `runWho(run)`:有 `experimentId` 用其 basename(唯一,与汇总表口径一致),否则退回 `agent/model`;`src/runner/attempt.ts`(进度上报侧)与 `src/cli.ts`(liveRows 构建侧)都改用它——两处必须同源,否则 progress 消息找不到行。适用判断:凡是用 `agent+model` 当唯一标识的地方,都要想到「同 agent 同 model 的实验变体」这个反例,唯一身份是 `experimentId`。

顺手补了 resume 可观测性:复用上次结果时只报数量不列清单,用户无法核对跳过的是哪些;现按 experiment 分组列出(`runner.resumeCarryDetail`,修在 `src/runner/run.ts`)。
