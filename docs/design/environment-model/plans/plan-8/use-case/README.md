# PLAN-8 用例映射

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本目录只展示同一套契约怎样完成真实用户目标。

- [Terminal-Bench:Eval Environment 与 Docker 内建规划](Terminal-Bench.md)
- [MemoryBench:Experiment defaultEnvironment 与 Eval setup](MemoryBench.md)

| Case | PLAN-8 路径 |
|---|---|
| C1 | `composeEnvironment()` 声明题目起点，Docker Provider 内建规划 |
| C2 | Experiment sandbox setup 在最终主 Sandbox 中准备实验条件 |
| C3 | 每题 Compose Case 启动后执行共享 Experiment setup |
| C4 | 多个 setup 按声明顺序执行，不建立通用 Layer 池 |
| C5 | 预装条件仍由领域 setup 函数检查实际状态 |
| C6-C7 | 外部 state 与复用周期保持独立生命周期 |
| C8 | MemoryBench 从 defaultEnvironment 启动，再执行 Eval setup |
| C9 | `environments[profile]` 提供无法现场组合的完整 Case |
| C10 | Eval 有 Environment 时不用 defaultEnvironment；没有时才 fallback |
| C11 | Terminal-Bench 在 send 后普通上传并运行官方测试 |
