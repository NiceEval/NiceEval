# Judge Runtimes

本方向定义由模型或独立 Agent 执行的 Judge Assertion。两种 runtime 共用同一个 Judge Check、已封口材料、结构化 Decision 与 unavailable 语义，但执行权限不同。

## 子方向

- [Judge Material](material/README.md) —— 用具名 View 明确授权 evaluator 的直接可见内容，并保存可审计 manifest。
- [LLM Judge](llm/README.md) —— 用 provider profile、判分 recipe 与静态判分图执行原生模型判定。
- [Agent Judge](agent/README.md) —— 让独立 Direct 或 Sandbox Agent 在授权 workspace 与受管工具范围内调查证据。

两种 runtime 都只产生 Judge Evaluation；Grading Claim 把它投影为 AssertionResult。Attempt 生命周期与最终四态折叠仍由 [Assertions](../../feature/assertions/README.md) 和 [Verdict](../../feature/verdict/README.md) 拥有。
