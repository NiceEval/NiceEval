# PLAN-6 用例映射

契约单源始终在[方案](../README.md)、[Library](../library.md)、[Architecture](../architecture.md)与[Lifecycle](../lifecycle.md)。
本目录只展示真实项目怎样使用候选 API。

## 真实仓库

- [Terminal-Bench:导入 task package,Experiment setup](Terminal-Bench.md) —— adapter 从上游 task package 派生 Compose source,Experiment 把 mempal 安装进主容器。
- [MemoryBench:Experiment template,Eval setup](MemoryBench.md) —— Experiment 的 E2B template 决定起点,Eval 在其中准备仓库与项目依赖。

## Cases 映射

| Case | PLAN-6 路径 |
|---|---|
| C1 | Terminal-Bench 的 folder-local Compose source |
| C2 | MemoryBench 的 Experiment 默认 template 与 sandbox setup |
| C3 | Terminal-Bench Compose 加 mempal Experiment setup |
| C4 | 多个 sandbox setup 按声明顺序执行 |
| C5 | MemoryBench mempal template 使 setup 函数的 check 命中 |
| C6 | Environment 收敛后进入独立 state lifecycle |
| C7 | 复用周期内按 owner 重新执行对应 setup |
| C8 | MemoryBench 从 Experiment template 启动,再执行 EvalDef setup |
| C9 | SandboxSpec `environments[profile]` 提供预制组合 case |
| C10 | 同一 SandboxSpec 对有 Environment 与无 Environment 的 Eval 走两条固定分支 |
