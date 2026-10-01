# PLAN-9 用例范围

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本目录只展示同一套契约怎样完成真实用户目标。

- [Terminal-Bench:Eval template owner 先准备](Terminal-Bench.md)
- [MemoryBench:Experiment template owner 先准备](MemoryBench.md)

| Case | PLAN-9 路径 |
|---|---|
| C1 | Eval 的 Compose / Dockerfile SandboxRecipe 激活 |
| C2 | Experiment template 激活并选择 Provider，Experiment setup 每复用周期先执行 |
| C3 | Eval template 激活，两种 scope 分别叠加 Experiment 与 Agent |
| C4 | 同 owner、同 scope 的 command 链按声明顺序执行 |
| C5 | template owner 保留每复用周期检查；逐 Attempt 检查显式使用 beforeEach |
| C6-C7 | State 独立；复用后 setup 保留，beforeEach 逐 Attempt 重跑 |
| C8 | MemoryBench 的 Experiment E2B template 与 mempal 复用周期激活，Eval checkout 逐 Attempt 运行 |
| C9 | 现场无法组合时改用一份融合后的完整 template，不提供第二起点替换 |
| C10 | 混合批次先穷举恰好一份 template，再逐合法 pair 确定 Provider 与 ownerOrder |
| C11 | send 后普通上传并运行官方测试 |
