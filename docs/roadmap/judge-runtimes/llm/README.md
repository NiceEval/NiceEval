# 原生 LLM Judge Runtime

LLM Judge 是 Assertion evaluator。它对作者显式交付的材料执行有界模型请求，并返回有限 `[0,1]` measurement、rationale 与 evidence。

每次 `t.judge.llm(...)` 调用直接登记一条 Assertion。Pass Eval 在同一 handle 调用 `.gate(n)`；Score Eval 可以调用 `.score(n)`。Judge 不拥有 Verdict、score policy 或控制流。

Judge Check 选择 recipe、绑定材料与 profile。Recipe 编译为静态 Judge Graph，Runtime 调度图中的节点，最终 Decision 写入同一条 AssertionResult。内部节点不产生额外 Assertion。

完整 Assertion 契约见 [Assertions](../../../feature/assertions/README.md)。

## 入口

- [Library](library.md) —— Check、材料、recipe 与 profile。
- [Architecture](architecture.md) —— 失败、Record 与不变量。
- [Use cases](use-case/README.md) —— 多节点和多模态场景。
