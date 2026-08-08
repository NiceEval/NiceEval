# 有序 Eval 序列 —— CLI

## 运行完整 Sequence

`--sequence` 只用于 `niceeval exp`，值是一个完整 Sequence ID：

```sh
niceeval exp compare/codex-gpt-5.6-luna \
  --sequence toggl-cli-capacity-policy
```

一次命令只选择一个 Experiment 和一个 Sequence。
Experiment 前缀必须唯一读取；Sequence ID 使用完整匹配，不用前缀一次命中多条序列。

`--sequence` 与 Eval 位置参数、`--tag`、`--rerun` 互斥。
Sequence 自己给出唯一成员范围，并且每次都真实重新执行完整选择；继续接受这些收窄或沿用参数会制造看似成功的残缺历史。

## 运行到指定成员

`--through` 只与 `--sequence` 搭配，值必须是该 Sequence 中的完整 Eval ID：

```sh
niceeval exp compare/codex-gpt-5.6-luna \
  --sequence toggl-cli-capacity-policy \
  --through toggl-cli-evolution/capacity-quarterly
```

Runner 从第一步真实执行到目标成员，包括目标成员。
CLI 不提供 `--from` 或只运行单个 Sequence step 的开关。

## `--dry` 人读输出

```text
sequence toggl-cli-capacity-policy · 8 steps · full replay · sequential
experiment compare/codex-gpt-5.6-luna
state —

step  eval                                                        action
01    toggl-cli-evolution/capacity-policy                         run
02    toggl-cli-evolution/capacity-weekly                         run after 01
03    toggl-cli-evolution/capacity-policy-update                  run after 02
04    toggl-cli-evolution/capacity-monthly                        run after 03
05    toggl-cli-evolution/capacity-fixed-exception                run after 04
06    toggl-cli-evolution/capacity-projects                       run after 05
07    toggl-cli-evolution/capacity-exception-revoked              run after 06
08    toggl-cli-evolution/capacity-quarterly                      run after 07

8 fresh attempts will run in one ordered Sequence Invocation.
Historical results are not carried into a Sequence Invocation.
```

Experiment 声明 `sharedState` 时，`state` 行显示其非敏感 key：

```text
state mempal/codex/cohort-2026-08-a · exclusive lease
```

这行只说明互斥身份，不宣称该状态为空或内容正确。

## `--dry --json`

JSON 计划在现有矩阵之外增加：

```ts
interface SequencePlan {
  readonly id: string;
  readonly definitionHash: string;
  readonly replay: "full";
  readonly throughEvalId?: string;
  readonly stateKey?: string;
  readonly steps: readonly SequencePlanStep[];
}

interface SequencePlanStep {
  readonly index: number;
  readonly evalId: string;
  readonly action: "run";
  readonly requiresIndex?: number;
}
```

`index` 从 0 开始，供机器消费；Human 输出把它显示成从 1 开始、按成员数量补齐宽度的序号。
Sequence 计划里没有 `carried` action，因为历史结果不会替代本轮步骤。

## 用法错误

缺成员时：

```text
Sequence toggl-cli-capacity-policy cannot run with experiment compare/codex.

Missing evals from the experiment selection:
  toggl-cli-evolution/capacity-quarterly

Include every Sequence member in Experiment.evals, or choose another Experiment.
No Attempt was dispatched.
```

把 Eval 位置参数与 `--sequence` 混用时：

```text
Eval positionals cannot narrow a Sequence Invocation.

Sequence: toggl-cli-capacity-policy
Remove the positional, or use --through <full-eval-id> to replay a valid prefix.
```

前序步骤 `errored` 或 `skipped` 时：

```text
Sequence history stopped at step 03: toggl-cli-evolution/capacity-policy-update
Verdict: errored

Steps 04–08 were not dispatched: sequence-history-incomplete.
Run the same command from a known external-state starting point.
```
