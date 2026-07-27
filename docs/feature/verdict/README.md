# Verdict

Verdict 是一个 Attempt 的互斥终态：`passed`、`failed`、`errored` 或 `skipped`。这一层拥有
Severity、`--strict`、`unavailable` 传播和四态优先级；它消费执行状态与 `AssertionResult[]`，
不执行检查，也不调用 Judge。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 理解 Severity、unavailable 与四态折叠 | [Architecture](architecture.md) |
| 理解 `--strict` 和 CLI 反馈 | [CLI](cli.md) |
| 把 soft 质量线收紧成门禁 | [用例](use-case/README.md) |

Assertion 的记录形状见 [Assertions](../assertions/README.md)。裁判模型调用见
[Judge](../judge/README.md)。
