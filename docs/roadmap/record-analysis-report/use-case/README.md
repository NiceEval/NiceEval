# Record → Analysis → Report —— 两套主用例

本方向只有两套面向作者的完整纵向用例。它们都从领域入口走到持久事实、Analysis 与 Report，但能力 owner 不同：

| 主用例 | 谁拥有领域能力 | 普通入口 | Analysis 消费 | Report 消费 |
|---|---|---|---|---|
| [官方能力：OTel Timing](官方OTelTiming.md) | NiceEval official package | Agent／Adapter tracing，例如 `aiSdkOtel()` | 官方 timing fields 与 `analyze()` | 官方 `ReportData`／Page；`show`、`view` 与 static export 复用同一结果 |
| [用户扩展：GPU 能耗](第三方事实扩展.md) | 第三方领域 SDK 与 application | `gpuEnergy({ meter })` Plugin | SDK 导出 `gpuSource`、`gpuEnergyJoules` 与 direct Analysis surface | 用户用这些 fields 编写 `aggregate()`／Page／component |

这里的“组件”只指 Report 的纯组合 component 或 semantic primitive。Analysis 不建立另一套组件系统：它提供 nominal
population、Dimension、Measure、Relation 与 `analyze()`；Report 不接触其 projection dependencies。

两套主用例遵守同一分层：

```text
领域入口
  → owner-specific producer binding
  → sealed domain value
  → RecordAttachment adapter / Record
  → 领域 population + fields
  → aggregate + Report component / Page
```

两条路径只有 authority 与发布方式不同。official adapter、binding 与 installation 由 NiceEval package 私有持有；第三方 adapter
与 binding 留在 SDK 内，application host 只安装 SDK 导出的 opaque installation。普通 Eval 作者在两条路径里都不接触
Record。

## 官方主用例的补充切片

- [断言与证据](断言与证据.md)说明 official Assertions 如何拥有 Evidence，而不建立通用 Evidence Attachment。
- [文件差异](文件差异.md)说明 official Diff 如何与 Assertions 共享 frozen domain input，同时保持独立 schema。

它们是“官方能力”主用例的领域变体，用来证明 OTel 不是特例；不构成第三套作者心智。

## 两套主用例共用的 Host 切片

[宿主写后读取与显式迁移](宿主写后读取与显式迁移.md)只解释 writer、fresh snapshot、lock、cache 与 maintenance
顺序。读取链固定为 `RecordReader → AnalysisSampleHandle → executeReport() → ReportExecution`。
迁移链固定为 `migration-required → plan → plan-bound authorization → migrate → fresh ReportExecution`。
CLI 与 programmatic maintenance SDK 解释同一个 facet。它们是两套主用例共同依赖的 host lifecycle，不是普通作者的第三套用法。

## 机械中立性的核对项

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与
[RecordAttachment adapter SPI](../../record-attachment-authoring/library.md)。两套主用例共同核对：

| 可核对项 | 期望 |
|---|---|
| domain schema / owner / adapter | 可以不同，由领域 owner 决定 |
| adapter authority | official 私有，第三方 SDK-private；不能互相冒充 |
| binding、total obligation、reservation | 相同 |
| adaptation target、plain-data snapshot | 相同 |
| blob closure、tracked command、poison | 相同 |
| generic sink 与 publication | 相同 |
| read state、Projection 与 Report problem handling | 相同 |
| migration 与 reuse policy | 各领域显式声明；writer 不猜 |
