# Agent-as-Judge —— CLI

Agent-as-Judge 不增加运行 flag。
Agent、model、reasoning effort、Sandbox 与 timeout 都来自可签入的 `judge.agent` 配置，避免一次临时覆写产生无法复现的分数。

## 计划反馈

`niceeval exp-plan` 在每个实际配对上显示 Agent Judge 的静态执行身份，不承诺动态代码分支一定会执行断言：

```text
JUDGE AGENT  codex · sandbox · gpt-5.4 · high
              timeout 15m · workspace snapshots allowed
```

未配置 `judge.agent` 时不显示这一块。
计划命中 `workspace: "snapshot"` 的事实只有运行 Assertion 后才能知道，因此 plan 不估算归档字节，也不声称一定创建裁判 Sandbox。

JSON 计划行增加可选字段：

```ts
interface AgentJudgePlan {
  agent: string;
  kind: "direct" | "sandbox";
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
  sandboxIdentity?: string;
}

interface ExperimentPlanRow {
  agentJudge?: AgentJudgePlan;
}
```

## 运行中反馈

一条 Agent Judge Assertion 执行时，Attempt 的 active detail 显示 `agent judge k/n`，并在同一行更新当前步骤：

```text
assertions.evaluate · agent judge 1/2 · investigating · 1m 18s
assertions.evaluate · agent judge 1/2 · validating decision · 1m 44s
assertions.evaluate · agent judge 1/2 · correcting protocol · 1m 46s
assertions.evaluate · agent judge 1/2 · cleanup · 1m 51s
```

`k/n` 只统计本 Attempt 实际登记的 Agent Judge Assertion。
Agent 的 `ctx.progress()` 可以替换 `investigating` 后面的细节，但不能伪造步骤、计数或 Assertion phase。

Direct 与 Sandbox 形态使用同一组步骤。
Sandbox 创建、快照导入和销毁作为该行的 detail 呈现，不增加顶层 Attempt phase。

## show 与 view

默认 `show` 在 Assertion 行显示分数、threshold 与 rationale 摘要：

```text
✗ gate · 并发修复质量   0.62 / 0.80
    rationale: 主路径已封口，但新增测试没有覆盖 close 与最终事件同时到达的窗口
    judge: codex · sandbox · gpt-5.4 · 2m 11s · $0.18
```

`niceeval show @<locator> --execution` 把裁判放在独立的 `JUDGE EXECUTIONS` 区块。
每次 execution 显示 Agent Session、工具调用、命令、协议修正轮、usage、引用证据和回收结果，不混入被测执行树。

`niceeval show @<locator> --diff` 只显示被测 Agent 的 diff。
裁判在副本中的修改不进入该切片；view 的 Agent Judge 详情可以显示裁判命令，但不提供裁判 diff 作为被测证据。

unavailable 行显示机器 reason 与一层可操作细节：

```text
◌ gate · 并发修复质量
    reason: agent-judge-invalid-decision
    evidence: correction turn still omitted evidence[0].source
```

## 机器输出

运行 JSONL 与 `show --json` 中，裁判事件和 usage 都带稳定角色与 execution id：

```ts
interface AgentJudgeMachineRef {
  role: "judge";
  executionId: string;
}
```

subject 与 judge usage 作为两个互斥桶输出。
总成本可以从两个桶求和，但机器输出不提供一个丢失角色归属的 usage 数组。

机器输出保留完整 `AgentJudgeDecision` 与 AssertionResult 的 evaluator 引用。
人读面的 rationale 截断不改变 JSON 值；Record 转写边界仍对裁判事件执行已知凭据脱敏与字段预算。

