# 可复现的 Experiment Pilot 抽样

## 用户需要

大型对照实验在 PR 或本地调试时，常常只需要先跑一小批 Eval。
这批结果必须可复现、对所有 Experiment 公平，并明确标成非全量结果。

```sh
niceeval exp compare --first 20
niceeval exp compare --sample 20 --sample-seed 7
```

`--first` 适合稳定的冒烟集合。
`--sample` 适合用固定 seed 抽到不同题目，而不依赖进程随机数或发现完成顺序。

## 核心语义

Runner 先完成 Experiment 与 Eval discovery，再对 Eval ID 做一次选择，最后展开 Experiment × Eval × attempts。
同一条命令选中的所有 Experiment 因而得到相同 Eval ID 集合。

选择发生在 attempts fan-out 之前。
一条 Eval 被选中后，它的全部计划 Attempt 继续遵守 `attempts`、`earlyExit`、预算与并发契约。

Run 保存：

- 选择前的候选 Eval ID；
- 实际选中的 Eval ID；
- `first | sample | all` 模式；
- sample seed 与算法版本；
- 选择分母、实际入选数与 non-final 标记。

选择没有包含全部候选时，Run 完成也只能称为 completed pilot，不能显示成全量结果。

## 与结果沿用

Pilot 不修改 Attempt fingerprint。
之后运行完整 Experiment 时，只要既有携带门都满足，Pilot 中完成的 Attempt 可以进入新 Run 写入的选择清单。

完整 Run 仍明确列出自己的全量候选与实际 carried provenance。
报告不会在读取时把某个 Pilot 临时补成完整结果集。

## 多 Experiment 公平性

两个以上 Experiment 同时使用 Pilot 选项时，它们在现有 `evals` 与尾随 Eval selector 求值后必须拥有相同候选集。
候选集不同是规划错误，Runner 展示每个 Experiment 独有的 Eval ID，并要求作者先收窄或修正配置。

系统不取交集静默丢题，也不取并集后允许某些对照组缺行。

## 研究取舍

[Braintrust](../../research/assertion-api-dx/braintrust-autoevals.md) 的 `--first N` 与 `--sample N` 会明确生成 non-final run，是这个 CLI 的直接启发。
NiceEval 额外要求固定 seed、持久算法版本，并让同批 Experiment 只选一次共同 Eval ID 集合。

[Ori Eval](../../research/assertion-api-dx/ori-eval.md) 的 `--pilot N` 仍走完整 Agent 与 Judge 路径，而不只估 token。
NiceEval 吸收这个真实执行边界，但不在 Pilot 选择 API 里绑定费用外推或 baseline 政策。

## 不做什么

- 不把 `--sample` 解释为现有报告 `Sample` 的另一个构造器；它只选择计划中的 Eval ID。
- 不用随机默认 seed；省略 seed 的随机样本不可复现。
- 不在每个 Experiment 内各抽一次，否则对照组会拿到不同题。
- 不新增 per-case `trialCount`；重复次数继续只由 Experiment `attempts` 声明。
- 不把 Pilot 结果自动提升为全量 baseline。

## 入口

- [CLI](cli.md) —— 参数、错误与人读计划。
- [Architecture](architecture.md) —— 选择顺序、稳定算法、Record 与 carry 边界。
