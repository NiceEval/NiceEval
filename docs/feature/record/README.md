# Record —— `.niceeval/` 的持久化事实

Record 是实验运行后落盘的持久化事实。`niceeval exp` 写入它，`niceeval show`、`niceeval view` 和
`niceeval/report` 读取它。完整字段和目录布局见 [Architecture](architecture.md)。

```text
.niceeval/
└── <experiment>/<run>/<eval-id>/a0/
    ├── result.json
    ├── events.json
    ├── sources.json
    ├── trace.json
    └── diff.json
```

Record 保存事实，不是终端输出或网页报告。结构化 execution outcome、`assertionResults`、grading、
diagnostics 与大型 evidence artifact 分别保存，读取面按需加载。

## AssertionResult 与 grading

`result.json` 以 `schemaVersion: 19` 和 `evaluationAlgorithm: "assertion/v1"` 保存
`assertionResults`。没有 `factResults`、`factUses` 或双格式读取。schema 18 整份 unsupported，
不跨 schema carry。

AttemptRecord 以 `evaluationKind` 为互斥 union：Pass Eval 保存 Verdict；Score Eval 保存
`scored { score, stop? }`、`unavailable` / `errored { partialScore, issues }` 或 `skipped`。
execution outcome 独立于这两种 grading。

`show`、`view`、JSON、export 与 source 从同一 projection 离线解释，不重新运行 Match、读取 Sandbox 或
调用 Judge。secret 从不落盘。

## 三层里的第一层

从磁盘到报告经过事实、选择与呈现三层。Record 只回答盘上有什么；选择范围、聚合和显示形状属于
[Sample](../sample/README.md) 与 [Reports](../reports/README.md)。

## 相关阅读

- [Architecture](architecture.md) —— 目录、版本、AttemptRecord 与 artifact 规范。
- [Assertions](../assertions/README.md) —— AssertionResult 与两种 grading。
- [Sample](../sample/README.md) —— 从 Record 选出可比较读取面。
- [Reports](../reports/README.md) —— 终端、网页和自定义报告。
