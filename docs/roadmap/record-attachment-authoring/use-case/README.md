# RecordAttachment adapter SPI —— 两套主用例

普通 consumer 不调用 Record API。SPI 的完整纵向用法只分两套：

## 官方能力

[官方 OTel Timing 完整路径](../../record-analysis-report/use-case/官方OTelTiming.md)展示 NiceEval package 怎样同时拥有：

- `niceeval.timing` 的 sealed value、adapter 与 Attempt binding；
- package-private `timingByAttempt` 与 `deriveObservedWindows()`，以及公开 `observedWindowMs`、`analyzeTiming()`；
- 内建 Analysis fields 与 ReportData／Page，以及 `show`、`view`、static export 的复用消费。

[内建事实](内建事实.md)、[Assertions 与 Evidence](../../record-analysis-report/use-case/断言与证据.md)和
[File Diff](../../record-analysis-report/use-case/文件差异.md)是同一官方路径的领域变体，不建立第二种 official writer。

## 用户扩展

[第三方 GPU 完整路径](../../record-analysis-report/use-case/第三方事实扩展.md)展示领域 SDK 与 application 怎样分工：

- SDK 定义 sealed value、adapter、binding、opaque installation 与 Analysis exports；
- 普通 Eval 只挂 `gpuEnergy({ meter })`；
- Analysis script 调用 `analyzeGpuEnergy()`；Report import `gpuSource` 与 `gpuEnergyJoules`；
- Report 作者用 `gpuEnergyJoules` 等 Analysis fields 编写 `aggregate()`／Page／纯组合组件。

下面的文档是这套用户扩展路径的机械切片，方便实现时按边界查阅；它们不是更多套作者模型：

- [领域 SDK 定义并生产自定义事实](定义并写入自定义事实.md)
- [Experiment 生命周期事实](实验生命周期事实.md)
- [Plugin 的 Run／Attempt binding](Plugin事实.md)
- [交接 Sandbox、Agent 与 Adapter 观测](观测交接.md)
- [Blob-backed 事实](Blob写入.md)
- [安装、读取与领域投影](读取投影.md)
- [演进并显式迁移](演进并迁移自定义事实.md) —— 具体 v1/v2、converter、programmatic migrate SDK、CLI 与 fresh execution。

契约单源始终在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md)、
[Lifecycle](../lifecycle.md) 与 [CLI](../cli.md)。
