# runner:earlyExit 去重键漏 experimentId,flags A/B 的另一组被静默跳过

## 现象

`tier3/ai-sdk-v7` 跑 `niceeval exp compare-prompts`(两个实验同 agent 同 model,只差
`flags.instructions`):CLI 报 `5 evals × 2 configs = 10 runs`,但汇总只有先跑完的那组
(concise)5 条结果,另一组(default)的 5 个 attempt 被静默丢掉——钱照花,结果没了,
`Result: 5 passed` 也不含任何 failed/skipped 提示。`--max-concurrency 1` 下确定性复现
(第一组全过后第二组整组消失);只筛一条 eval 时偶尔两组都在(时序窗口没触发)。

## 根因

两层叠加:

1. `src/cli.ts` 里 `earlyExit: flags.earlyExit ?? exp.earlyExit ?? true`——**默认开**;
2. `src/runner/run.ts` 的 attempt 去重键 `key = agent|model|evalId`,**不含 experimentId**。
   earlyExit 的语义是"同一个配置的重试轮,过了就不再烧钱",但键太粗,把"另一个实验的
   同名 eval"也当成了重试轮:第一组 pass 把 key 记进 passedKeys,第二组同 key attempt
   直接跳过(`run:earlyExit` 事件,console 不显示)。

compare-models 组从未踩雷纯属侥幸:model 恰好在键里。同理 `reporters/artifacts.ts` 的
工件目录 `<evalId>/<agent>/<model>/a<n>` 也缺 experiment 维度,两个实验的工件互相覆盖。

## 修法

- `src/runner/run.ts`:key 加上 experimentId 前缀(`${experimentId ?? ""}|agent|model|evalId`),
  earlyExit 的跳过/abort 回到"同配置重试轮"的本义;
- `src/runner/reporters/artifacts.ts`:attemptDir 在 model 段后加 experiment 段
  (`compare-prompts/concise` → `compare-prompts_concise`),`docs/results-format.md` 同步;
- 实测:`5 evals × 2 configs = 10 runs` 后两组各 5 条结果都在。

适用场景:任何"多实验同 agent 同 model、只差 flags / reasoningEffort 等非键维度"的对比组。
新增会进 attempt 键语义的实验维度时,检查 run.ts 的 key 与 artifacts.ts 的 attemptDir 是否同步。

## 回归与再修(2026-07-10)

本修法(`5eec3b6`)被一小时后的 view 深链 commit `4b39af1` **整体误回退**——那个 commit
只该动 view,却把 run.ts 的 key、artifacts.ts 的 experiment 段、连同 cf56ab3 的
eval 级 scoped reporters 接线一起打回旧版(典型的旧基线工作树直接 commit)。回归
**随 v0.4.4 发布**:下游同 agent 同 model 的实验对(如 baseline vs --mempal 变体)
在 0.4.4 上会互相触发 earlyExit 跳过/丢结果,工件互相覆盖;docs/results-format.md
和 results/format.ts 的 attemptDirOf(reader)从未回退,读写两侧一直不一致。
已在 main 再修(三处一并恢复);用 0.4.4 跑过的 compare 快照要重新核对完整性。

教训:误回退不会被任何守护拦住——`docs-consistency` 只查链接、reference 漂移守护只查
TSDoc。跨 commit 覆盖检查靠 commit 前 `git diff` 只含本任务文件(AGENTS.md 已有此规,
这次是没执行)。
