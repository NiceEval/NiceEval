# 可重评分 Eval

Replayable Eval 把一次 Agent execution、一次 evaluator 求值与后续评分投影分开保存。Execution 先封口为 sealed semantic source graph；每次 grading 以当前版本的定义绑定 source，复用或创建 immutable Judge Evaluation，再产生新的 Grading Claim。

它绝不改写旧 claim，也不能把任意 inline JavaScript value 因为曾有旧 AssertionResult 而自动变成
可重评分输入。

```text
Agent execution ──► sealed Execution graph
                              │
                  current GradingDefinition
                              │
                              ▼
                     JudgeEvaluation
                              │
                              ▼
                      GradingClaim
               AssertionResult + projection
```

Judge Evaluation 拥有材料 manifest、presentation/investigation closure 与 Decision。Grading Claim 拥有 entry identity、subject reference、evaluation kind、threshold、score 与 control policy。

只改投影 policy 可以复用同一次 Evaluation，不会重跑模型或裁判 Agent。

Pass Claim 产生 Verdict；Score Claim 产生累计 score，不产生 Verdict。新的 Grading 不会改写 Execution、旧 Evaluation 或旧 Claim，也不能把旧 AssertionResult、Attachment blob 或任意 inline JavaScript value 复原成材料。

## 入口

- [Architecture](architecture.md) — Execution、Judge Evaluation 与 Grading Claim 的 owner、封口和 identity。
- [Library](library.md) — 定义 grading、绑定 sealed source 与读取面。
- [CLI](cli.md) — 重评分命令与可见结果。
- [Use cases](use-case/README.md) — 多轮 HITL、历史重评与 reuse。
