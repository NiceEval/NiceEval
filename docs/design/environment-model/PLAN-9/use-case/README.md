# PLAN-9 用例覆盖

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本目录只展示同一套契约怎样完成真实用户目标。

- [Terminal-Bench:Eval template owner 先准备](Terminal-Bench.md)
- [MemoryBench:Experiment template owner 先准备](MemoryBench.md)

| Case | PLAN-9 路径 |
|---|---|
| C1 | Eval 的 Compose / Dockerfile SandboxRecipe 激活 |
| C2 | Experiment fallback 激活，Experiment setup 先执行 |
| C3 | Eval setup 后叠加 Experiment 与 Agent setup |
| C4 | 同 owner 的 setup 链按声明顺序执行 |
| C5 | template owner 仍保留实际状态检查 |
| C6-C7 | State 独立，复用后逐 Attempt 重跑同一 owner stack |
| C8 | MemoryBench 的 Experiment E2B template 激活 |
| C9 | profile 完整 Case 替换物理实现，不改变 ownerOrder |
| C10 | 混合批次逐 Eval 解析 template owner |
| C11 | send 后普通上传并运行官方测试 |
