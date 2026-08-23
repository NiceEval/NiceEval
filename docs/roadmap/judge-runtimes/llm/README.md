# 原生 LLM Judge Runtime

LLM Judge 是无调查权限的 Assertion evaluator。它把一个已封口 Judge Check 渲染成有界模型请求，并返回有限 `[0,1]` measurement、公开 rationale 与 evidence refs。

每次 `t.judge.llm(...)` 调用直接登记一条 Assertion。Pass Eval 在同一 handle 调用 `.gate(n)`；Score Eval 可以调用 `.score(n)`。Judge 不拥有 Verdict、score policy 或控制流。

Judge Check 只选择 recipe 并绑定材料；[Judge Material](../material/README.md) 拥有 View、selector、预算与可见性 manifest。LLM runtime 选择 provider profile，把 recipe 编译成静态 Judge Graph，并把最终 Decision 交给同一条 AssertionResult。内部节点不产生额外 Assertion。

完整 Assertion 契约见 [Assertions](../../../feature/assertions/README.md)。

## 入口

- [Library](library.md) —— profile、recipe graph、调用与显式 batch。
- [Architecture](architecture.md) —— 请求边界、失败、Record 与不变量。
- [Use cases](use-case/README.md) —— 多节点和多模态场景。
