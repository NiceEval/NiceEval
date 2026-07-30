# Assertions

Assertion 是一次可记录的检查。
值 matcher、作用域检查、Sandbox 验证、资源上限和 Judge 都产出同一种 `AssertionResult`；这一层负责检查什么、证据是否完整以及结果怎样落盘，不决定整个 Attempt 的最终状态。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 写值、作用域或自定义 Assertion | [Library](library.md) |
| 理解 `AssertionResult`、scope 与 evidence | [Architecture](architecture.md) |
| 理解通过制、计分制与题内计分项 | [计分粒度](library/score-points.md) |
| 查看 Assertion 在 show / view 中的投影 | [展示](library/display.md) |

Judge 的模型调用契约见 [Judge](../judge/README.md)。
Severity 与最终四态折叠见[Verdict](../verdict/README.md)。

## 目录索引

```text
assertions/
├── README.md
├── library.md
├── architecture.md
├── library/
│   ├── value-assertions.md
│   ├── scoped-assertions.md
│   ├── custom-assertions.md
│   ├── score-points.md
│   └── display.md
├── architecture/
│   ├── scopes.md
│   └── evidence.md
└── reference/
    └── provenance.md
```
