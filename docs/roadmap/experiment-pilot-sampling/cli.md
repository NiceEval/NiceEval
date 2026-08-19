# Experiment Pilot 抽样 —— CLI

## 参数

```sh
niceeval exp <experiment-selector> [<eval-prefix>...] --first <count>
niceeval exp <experiment-selector> [<eval-prefix>...] --sample <count> --sample-seed <seed>
```

`count` 必须是正 safe integer。
`seed` 必须是非负 safe integer。

`--first` 与 `--sample` 互斥。
`--sample` 要求同时提供 `--sample-seed`；`--sample-seed` 也不能单独出现。

count 大于或等于候选数时，全部候选都入选。
该 Run 是 full selection，不带 non-final 标记；CLI 说明请求数量超过候选数，但不把它当错误。

## `--first`

`--first N` 按规范化 Eval ID 的 Unicode code point 升序选择前 N 条。
它不使用文件系统遍历顺序、import 完成顺序或历史结果状态。

```text
pilot selection: first 20 of 184 evals
pilot result: not final · ordered by Eval ID
```

## `--sample`

`--sample N --sample-seed S` 使用稳定 hash ranking，不调用平台 PRNG。
相同候选 ID、N、seed 与算法版本必须得到相同选择和顺序。

```text
pilot selection: sample 20 of 184 evals
seed: 7
pilot result: not final
```

## `--dry`

Pilot 选项与现有 `--dry` 组合时，CLI 展示选择但不创建 Run：

```sh
niceeval exp compare --sample 20 --sample-seed 7 --dry
```

人读输出列出：

- 每个被选 Experiment 的候选数；
- 候选集合是否一致；
- 选择模式、数量与 seed；
- 选中 Eval ID；
- 展开后的 Attempt 数与 carry 计划。

`--json` 在 plan 事件中提供同一组结构化字段。

## 候选集不一致

```text
error: Pilot selection needs the same Eval set for every Experiment.
  compare/codex has 184 evals
  compare/claude has 181 evals
  only in compare/codex: memory/windows, memory/vision, tools/docker

usage: Align the Experiments' Eval filters, or run them separately.
```

该错误发生在 fingerprint、Provider planning 与任何外部 I/O 之前。

## 结束反馈

结束摘要必须同时显示执行完成度与入选比例：

```text
completed pilot · 20 / 184 evals selected · seed 7
20 completed · 0 attempts missing results
pilot result is not final: 164 evals were not selected
```

“Run 内没有执行缺口”不能改写成“选择了全部已知 Eval”。
