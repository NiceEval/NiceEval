# Agent-as-Judge

Agent-as-Judge 让一条 Assertion 由独立 Agent 在受管能力内调查证据后产生 measurement。它适用于需要打开授权 workspace snapshot、运行受管工具或追踪引用的开放式判据。

Agent Judge 是 Assertion evaluator，不是第二个被测对象。调用 recipe 时登记一条 Assertion；Pass Eval 对同一 handle 用 `.atLeast(n)`，Score Eval 用 `.score(n)`。Agent Judge 不拥有 Verdict、score policy 或控制流。

被测 Agent 与裁判 Agent 使用独立 Session。两者共用的 Judge Check、Material View 与直接可见性 manifest 由 [Judge Material](../material/README.md) 定义；workspace 是 invocation capability，不是普通 material slot。

## 入口

- [Library](library.md) —— runtime options、workspace 与受管 capability。
- [Architecture](architecture.md) —— 调查 broker、安全、evidence 和结果边界。
- [Lifecycle](lifecycle.md) —— 独立 Session 的创建与回收。
- [Use cases](use-case/README.md) —— 对话与仓库审查。
