# RecordAttachment adapter SPI —— Use Case

契约单源始终在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md)、
[Lifecycle](../lifecycle.md) 与 [CLI](../cli.md)。用例只展示领域 SDK 怎样包装 SPI；普通 consumer 不调用 Record API。

- [领域 SDK 定义并生产自定义事实](定义并写入自定义事实.md) —— 对比 SDK adapter 与普通 Eval 调用面。
- [Experiment 生命周期事实](实验生命周期事实.md) —— Run binding 怎样形成 total obligation。
- [Plugin 的 Run／Attempt binding](Plugin事实.md) —— 同一 mount 怎样拆成两个 authority 独立 occurrence。
- [交接 Sandbox、Agent 与 Adapter 观测](观测交接.md) —— 资源只交回领域 observation，不取得 Record capability。
- [内建事实](内建事实.md) —— official Assertions、Diff、Timing 怎样复用同形 binding。
- [Blob-backed 事实](Blob写入.md) —— adapter target 怎样建立 owner-local blob closure。
- [安装、读取与领域投影](读取投影.md) —— opaque installation 与 SDK-owned Analysis API。
- [演进并显式迁移](演进并迁移自定义事实.md) —— 相邻 converter、unavailable edge 与 CLI。
- [第三方 GPU 完整路径](../../record-analysis-report/use-case/第三方事实扩展.md) —— Plugin、bracketed meter、v1→v2、Analysis 与 Report。
