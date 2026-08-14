# Judge Runtimes

本方向定义由模型或独立 Agent 执行的 Judge Assertion。两种 runtime 共用已封口材料、明确 recipe、结构化结果与 unavailable 语义，但调查权限和执行边界不同。

## 子方向

- [Agent Judge](agent/README.md) —— 让独立 Direct 或 Sandbox Agent 在授权范围内调查证据并作出判定。
- [LLM Judge](llm/README.md) —— 用固定材料、provider profile、判分 recipe 与静态判分图执行原生模型判定。

两者都只产生 Assertion 事实；Attempt 生命周期与最终四态折叠仍由 [Assertions](../../feature/assertions/README.md) 和 [Verdict](../../feature/verdict/README.md) 拥有。
