# `--stats`：Eval × Experiment 稳定性矩阵

`--stats` 选择一个 stability target。
调用方明确提供要比较的 materialized Sample 或 union，plan 再列出 Eval、Experiment、历史成员和所需 measure；它不通过文件扫描或可变 head 自动找历史。

```sh
niceeval show --stats
niceeval show security/ --stats
```

矩阵中的每格显示已建立的通过、失败、错误、coverage、verification 和 refs。
「从未通过」只在该固定历史输入与 policy 下成立；它不是对未来 Graph 或未选成员的判断。

## 边界

- `--stats` 与显式 `--report`、单一 `@<locator>` target 互斥。
- 需要逐次证据时，选择同一历史 Sample 的 `--history` target。
- unavailable 与 export failure 分别保留原有语义，不能因统计聚合而互相转换。

## 相关阅读

- [Calculations](../calculations.md) —— stability 不作为通用魔法。
- [`--history`](history.md) —— 固定历史成员的时间轴。
- [Sample Library](../../sample/library.md) —— unionSamples 与 conflict policy。
