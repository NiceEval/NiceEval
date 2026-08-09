# Verdict

Verdict 是依据一个 Attempt revision 的证据形成的互斥 Claim：`passed`、`failed`、`errored` 或 `skipped`。
它不是 Attempt lifecycle state：Attempt 只会是 `active`、`completed` 或 `abandoned`。这一层拥有 Severity、`--strict`、`unavailable` 传播和四态优先级；它消费执行错误 Observation 与 Assertion Claim，不执行检查，也不调用 Judge。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 理解 Severity、unavailable 与四态折叠 | [Architecture](architecture.md) |
| 理解 `--strict` 和 CLI 反馈 | [CLI](cli.md) |
| 把 soft 质量线收紧成门禁 | [用例](use-case/README.md) |

Assertion 的条目形状见 [Assertions](../assertions/README.md)。
裁判模型调用见 [Judge](../judge/README.md)。
