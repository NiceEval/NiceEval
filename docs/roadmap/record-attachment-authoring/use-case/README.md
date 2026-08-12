# RecordAttachment 作者 API —— Use Case

契约单源始终在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md)、
[Lifecycle](../lifecycle.md) 与 [CLI](../cli.md)。用例只做搭配与叙事，不复制定义。

- [Eval 写入 Attempt 自定义事实](定义并写入自定义事实.md) —— 在 Eval occurrence 中保存零 blob 的运行观测。
- [Experiment 生命周期写入 Run 事实](实验生命周期事实.md) —— 用 setup 与 teardown 为一份 Run 写入两个不同事实。
- [Plugin occurrence 的窄写入权](Plugin事实.md) —— 对比 Eval Plugin、Experiment Plugin 与 Group，并保留框架 provenance。
- [交接 Sandbox、Agent 与 Adapter 观测](观测交接.md) —— 让资源与适配边界交回事实，不扩大为泛化 writer。
- [内建子功能写入官方事实](内建事实.md) —— 让内建 producer 经过私有 definition 与领域 adapter 复用同一中立路径。
- [写入 blob-backed 事实](Blob写入.md) —— 用 blob builder 创建 owner-local closure。
- [安装、读取与投影事实](读取投影.md) —— 显式安装 family，并处理 reader 与 projector 的穷尽状态。
- [演进、迁移与保留历史事实](演进并迁移自定义事实.md) —— 用相邻 converter 或 unavailable edge 迁移已安装的 family。
