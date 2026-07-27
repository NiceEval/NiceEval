# Scoring —— 断言、评分与判定

Scoring 回答“一次 eval attempt 算不算通过”。eval 通过值断言、作用域断言、LLM judge、Sandbox 验证和效率约束记录 `Assertion`，运行器再把执行状态与断言折叠为 `Verdict`。

## 五种评分方式

1. **值断言**：`t.check(value, matcher)` / `t.require(value, matcher)`。
2. **作用域断言**：`t.calledTool()`、`session.succeeded()`、`turn.event()` 等。
3. **LLM-as-judge**：对开放式回答、diff 或文件内容评分。
4. **测试即评分**：运行 Sandbox 命令，再用普通 matcher 判断结果。
5. **效率约束**：`maxTokens()`、`maxCost()` 等。

`Assertion` 是评分输入，Scoring 是包含记录、严重度、证据作用域、CLI strict 模式和最终判定的完整功能，因此一级目录使用 `scoring`。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 写值断言、作用域断言、judge 或自定义 matcher | [Library](library.md) |
| 理解通过制、计分制与题内给分 | [计分粒度](library/score-points.md) |
| 理解 scope、Severity、Verdict 与证据折叠 | [Architecture](architecture.md) |
| 理解 `--strict` 和 CLI 结果 | [CLI](cli.md) |
| 照着一个真实场景走一遍全流程 | [用例](use-case/README.md) |

## 目录索引

```text
scoring/
├── README.md
├── library.md
├── architecture.md
├── cli.md
├── library/
│   ├── value-assertions.md
│   ├── scoped-assertions.md
│   ├── judge.md
│   ├── score-points.md
│   └── custom-assertions.md
├── architecture/
│   ├── scopes.md
│   ├── severity-and-verdict.md
│   └── evidence.md
├── use-case/
│   ├── README.md
│   ├── strict-quality-gate.md
│   └── judge-not-scoring.md
└── reference/
    └── provenance.md
```

驱动会话和读取 Turn 见 [Eval](../eval/README.md)；运行命令与读取 diff 见 [Sandbox](../sandbox/README.md)。

外部项目给这套设计带来了什么，见 [设计来源](reference/provenance.md)。
