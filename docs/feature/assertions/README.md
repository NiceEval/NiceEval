# Assertions

Assertion 是一次可留档的检查。
值 matcher、作用域检查、Sandbox 验证、资源上限和 Judge 都形成同一种 Assertion result，并写入 Assertion owner 的通道；这一层负责检查什么、证据是否完整以及当时的判断怎样落盘，不决定 Attempt 的 lifecycle 或最终 Verdict。

作者 API、matcher、collector 和求值流程可以独立演进。producer 在发布 Attempt 前把它们的内存结果归一成冻结的 <code>niceeval.assertions</code> 展示投影；Record 与标准 Report 只依赖这份投影，不依赖产生它的 API 或运行时类型。

这项稳定承诺从 <code>niceeval.record</code> 首次发布开始。投影的精确形状与跨代读取条件见 [Architecture](architecture.md#稳定落盘投影)。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 写值、作用域或自定义 Assertion | [Library](library.md) |
| 理解 Assertion result、scope 与 evidence | [Architecture](architecture.md) |
| 理解通过制、计分制与题内计分项 | [计分粒度](library/score-points.md) |
| 查看 Assertion 在 show / view 中的呈现 | [展示](library/display.md) |

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
