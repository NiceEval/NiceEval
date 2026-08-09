# 可重评分 Eval —— CLI

## 类型显式的选择器

`@...` 继续只表示 AttemptLocator。
Run 与 GradingRun 使用自己的 typed option：

```sh
niceeval grade --run <run-id> [--force] [--dry]
niceeval show --run <run-id> [--grading-run <grading-run-id>]
niceeval view --run <run-id> [--grading-run <grading-run-id>]
niceeval show @<attempt-locator>
```

Run ID 使用 `run_...`，GradingRun ID 使用 `gr_...`。
对应 option 接受完整 ID 或唯一前缀；CLI 不按长度或内容猜实体类型。

`--grading-run` 必须引用该 Run 的 SampleManifest。
不匹配时是用法错误，不读取两批结果后尝试对齐。

## `niceeval grade --run`

该命令读取目标 Run 的 SampleManifest，并按其中的 Eval ID 做当前 declarative Eval discovery。
该命令始终处理完整 Run，不提供半批 Eval selector，也不公开 grading profile。

默认应用 Grading reuse。
grading source、inputs 或 Fact / Match / projector 版本改变时，fingerprint miss 并创建新 Grading。

```text
grading plan · run_01J...
12 execution entries
8 reusable grading results
3 to grade
1 incompatible · required ref "auditTurn" is missing
```

命令结束后总会产生一份独立 GradingRun。
全部 entry reused 时，批次仍保存这次明确选择与 coverage，但不会复制旧 Claim。

## `--dry`

```sh
niceeval grade --run run_01J... --dry
```

dry plan 执行当前 link discovery、inputs identity 与 compatibility 检查，但不运行 grading callback、matcher 或 Fact evaluator。
它不创建 GradingRun，也不修改 Record。

输出至少包含：

- SampleManifest 分母与 Execution graph 状态；
- reused、to-grade、inline-owned、execution-terminal 与 gap 数量；
- grading source、inputs、required Ref 与 evaluator identity；
- source、Ref、private input 与 Record graph 不兼容原因。

## `--force`

```sh
niceeval grade --run run_01J... --force
```

`--force` 绕过 Grading reuse，为每个 compatible completed execution 创建新的 Grading。

该选项不重跑 Agent、不创建 Sandbox、不改写旧 Claim，也不改变 Run 的 default GradingRun。
新批次只有通过 `--grading-run` 显式选择后才进入报告。

## Judge / LLM 边界

本轮 replayable grading 不提供 Judge / LLM producer，因此 `grade` 不做 Judge 预检、费用估算或强制重新调用。
这些 CLI 行为必须随未来的离线 Judge Roadmap 一起设计，不能从现有 inline Judge 隐式继承。

## 默认读取

bare `niceeval show` 与 `niceeval view` 对每个 Experiment：

1. 读取 Record index 的 `currentExecutionRunRef`；
2. 读取该 Run 的 SampleManifest；
3. 只跟随该 Run 明确链接的 default GradingRun；
4. 再把多个 Experiment 的 GradedSample 组合。

default GradingRun incomplete 或 interrupted 时，当前报告显示 grading gap。
它不会回退到较旧但更完整的 GradingRun。

历史 regrade 通过显式选择读取：

```sh
niceeval show --run run_01J... --grading-run gr_01K...
niceeval view --run run_01J... --grading-run gr_01K...
```

graded entry 的 `show` 与 JSON 复用 Assertion 结果投影，并原样保留每个必填 Fact use key。
人读标题仍优先用 label；key 不替代 `factId`、Claim identity 或 evidence locator。

## 诊断

稳定错误至少包括：

| Code | 含义 | 下一步 |
|---|---|---|
| `grading-definition-unavailable` | 当前 Eval link 或 grading module 不存在 | 恢复当前 definition 或切换 checkout |
| `grading-input-unavailable` | rubric、criteria 或 private digest 无法取得 | 恢复输入后重试 |
| `grading-ref-incompatible` | required Ref path/kind 不被 source graph 满足 | 选择兼容 grader 或重跑 Agent |
| `grading-source-incomplete` | Execution graph 未完整封口 | 重跑 Agent |
| `grading-source-corrupt` | graph、强边或 schema 损坏 | 修复 Record graph 或重跑 |

private input 缺失时，历史结果读面区分：

```text
historical claim: readable
reproducibility: unavailable (private input missing)
```
