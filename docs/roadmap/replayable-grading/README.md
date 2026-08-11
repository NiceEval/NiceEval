# 可重评分 Eval

Replayable Eval 把一次 Agent execution 与后续 grading 分开保存。execution 先封口为 sealed
Observation/ref graph；每次 grading 以明确版本的定义产生新的 immutable claim。

它绝不改写旧 claim，也不能把任意 inline JavaScript value 因为曾有旧 AssertionResult 而自动变成
可重评分输入。

```text
Agent execution ──► sealed Observation/ref graph
                              │
                 GradingDefinition@version
                              │
                              ▼
                    immutable grading claim
                              │
                              ▼
                  AssertionResult + pass or score projection
```

每个新 grading claim 有自己的 entry identity、subject reference、evaluator identity、AssertionResult 和
evaluationKind。Pass claim 产生 Verdict；Score claim 产生累计 score，不产生 Verdict。

## 入口

- [Architecture](architecture.md) — execution 与 grading 两层、封口和 identity。
- [Library](library.md) — 定义 execution、grading 与读取面。
- [CLI](cli.md) — 重评分命令与可见结果。
- [多轮 HITL](use-case/multi-turn-hitl.md) — 保留真实对话证据后重评。
