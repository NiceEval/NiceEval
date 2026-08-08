# 分组 Sandbox 复用 —— Use Cases

规则难懂的地方按真实项目查。
契约单源始终在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)；用例只做搭配与叙事。

- [MemoryBench](MemoryBench.md) —— 在纵向记忆题目录定义强制共享边界，各 Experiment 使用独立实例。
- [Terminal-Bench](Terminal-Bench.md) —— 不声明运行 Sandbox 复用，BuildKey 仍可共享构建输出。
- [NiceEval-Eval](NiceEval-Eval.md) —— 在 `experiment/` 中定义两道当前项目题的具名组，迁移题保持 fresh。
