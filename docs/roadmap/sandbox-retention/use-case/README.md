# Sandbox 默认停驻与回收 —— Use Cases

契约单源始终在 [README](../README.md)、[Library](../library.md)、[CLI](../cli.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
用例只串联真实任务路径。

- [失败后进入收尾 Sandbox](失败后进入收尾Sandbox.md) —— 不预判失败，在运行后检查 bounded Provider 保留的 filesystem。
- [CI 立即销毁](CI立即销毁.md) —— 让批跑不留下远端 snapshot 或本地 stopped container。
- [Docker 显式停驻与回收](Docker显式停驻与回收.md) —— 一次签入项目策略，再用 enter、suspend、delete 与 prune 管理。
