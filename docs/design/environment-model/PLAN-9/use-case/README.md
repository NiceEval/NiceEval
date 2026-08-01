# PLAN-9 用例覆盖

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本目录只展示同一套契约怎样完成真实用户目标。

- [Terminal-Bench:Eval template owner 先准备](Terminal-Bench.md)
- [MemoryBench:Experiment template owner 先准备](MemoryBench.md)

| Case | PLAN-9 路径 |
|---|---|
| C1 | Eval 的 Compose / Dockerfile SandboxRecipe 激活 |
| C2 | Experiment fallback 激活，Experiment setup 每窗口先执行 |
| C3 | Eval template 激活，两种 scope 分别叠加 Experiment 与 Agent |
| C4 | 同 owner、同 scope 的 command 链按声明顺序执行 |
| C5 | template owner 保留窗口检查；逐 Attempt 检查显式使用 beforeEach |
| C6-C7 | State 独立；复用后 setup 保留，beforeEach 逐 Attempt 重跑 |
| C8 | MemoryBench 的 Experiment E2B template 与 mempal 窗口激活，Eval checkout 逐 Attempt 运行 |
| C9 | profile 完整 Case 替换物理实现，不改变 ownerOrder |
| C10 | 混合批次逐 Eval 解析 template owner |
| C11 | send 后普通上传并运行官方测试 |
