# PLAN-7 用例覆盖

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本目录只展示同一套契约怎样完成真实用户目标。

- [Terminal-Bench:每题自包含，turn 后运行官方测试](Terminal-Bench.md)
- [MemoryBench:Experiment template 加 Eval setup](MemoryBench.md)

| Case | PLAN-7 路径 |
|---|---|
| C1 | Eval 声明 folder-local Environment source |
| C2 | SandboxSpec 默认 case 与 sandbox setup |
| C3 | materializer 从 Eval source 构建并启动 Sandbox 后执行 Experiment setup |
| C4 | SandboxSpec setup 链显式排序 |
| C5 | 领域 setup helper check/install/recheck |
| C6-C7 | 独立 state lifecycle 与 Sandbox 复用契约 |
| C8 | MemoryBench 默认 template 后执行 EvalDef setup |
| C9 | `environments[profile]` 提供预制完整 case |
| C10 | 有 source 和无 source 的 Eval 各走自己的解析分支 |
| C11 | Terminal-Bench 每题在 `send` 后直接用普通 Sandbox API 上传并跑测 |
