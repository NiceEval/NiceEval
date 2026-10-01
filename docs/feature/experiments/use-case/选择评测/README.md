# Eval 选择 —— 用例

| 目标 | 用例 |
|---|---|
| 按目录让 Experiment 负责一族 Eval | [按路径前缀选择](../selection-by-path-prefix.md) |
| 按标签或运行时要求过滤 Eval | [按标签选择](../selection-by-tags.md) |
| 同一范围含两种题型 | [拆开混型评测](../selection-split-eval-kinds.md) |
| 在一次 CLI 调用中临时收窄并预览计划 | [选择器与 `--dry`](../selection-dry-preview.md) |
| 先确认有哪些 Eval 被发现 | [`niceeval list`](../selection-list-evals.md) |
| 先确认有哪些 Experiment 可运行 | [`niceeval exp list`](../selection-list-experiments.md) |

选择规则单源见 [Library](../../library.md#evals遍历发现结果自定义选择) 与 [CLI](../../cli.md#实验选择器怎样求值)。
