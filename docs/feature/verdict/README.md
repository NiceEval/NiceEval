# Verdict

Verdict 是通过制 Attempt 的互斥终态：`passed`、`failed`、`errored` 或 `skipped`。
它只折叠普通 `factResults`、`factUses` 与执行终态；不执行检查，也不拥有 Judge 专用规则。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 了解 Fact use 怎样决定终态 | [Architecture](architecture.md) |
| 了解 CLI、show 与 report 怎样呈现终态 | [CLI](cli.md) |
| 把开放式质量检查写成明确阈值 | [Judge](../judge/library.md) |

Fact 的生产、消费和证据形状见 [Assertions](../assertions/README.md)。
计分制的独立终态与聚合见 [计分 Fact](../assertions/library/score-points.md)。
