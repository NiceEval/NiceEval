# RecordAttachment adapter SPI

普通 Eval、Experiment 与 Plugin 消费者应调用 Assertions、File Diff、Timing 或第三方 SDK 的领域 API。
他们不声明 RecordAttachment、write grant 或 migration，也不在 `TestContext` 或 Hook context 中提交 Record command。

领域 SDK 仍需要一条中立扩展路径。它先形成 sealed domain value，再由 `niceeval/record/adapter` 中的
RecordAttachment adapter 把该值转换为版本化 Attachment。官方事实与第三方事实共用这条 SPI；官方只多一枚私有
`niceeval.*` namespace authority。

## 核心心智

```text
普通领域 API
  → occurrence-local producer lifecycle
  → sealed domain value
  → owner-specific RecordAdapterBinding
  → RecordAttachment adapter
  → canonical RecordAttachment command
```

adapter 声明与实际使用分成三种不能互相反推的能力：

```text
defineRecordAttachmentAdapter(...)
  ├─ installation ───────→ Record host 读取与显式 migration
  ├─ projector ──────────→ SDK 构造领域 Analysis API
  └─ exact adapter ──────→ SDK 构造 owner-specific binding
                                 │
                                 ▼
                     actual owner 的 total producer obligation
```

| 能力 | 谁持有 | 它不代表什么 |
|---|---|---|
| `RecordAttachmentAdapter` | 领域 SDK 内部 | 不是 live writer，不是 application install |
| `RecordAttachmentInstallation` | Record／maintenance host | 不能构造 binding 或取得 producer lease |
| `RecordAttachmentProjector` | SDK 的 Analysis 模块 | 不能反推 adapter、schema graph 或 writer |
| `RecordAdapterBinding` | linked producer occurrence | 不是可选写入机会；actual owner 必须 accepted once 或失败 |

## 完整生产义务

一个 mounted binding 对每个实际执行 owner 建立 total producer obligation。owner 打开时，host 就 reserve family 并登记
pending producer command。正常的 empty、partial 与 unavailable 必须成为 sealed domain value；未产值、重复产值、
adaptation failure、release failure 或 durable write failure 都令 owner 失败。

carry／reuse 的历史 Attempt 不重新打开 producer。历史 Attachment 是否必须存在或为 current，仍由独立 reuse contract
决定，不能由 binding 暗改。

## 谁怎样使用

- 普通 Eval／Experiment 作者只配置或调用领域 SDK，例如 `gpuEnergy({ meter })`。
- 领域 SDK 作者定义 sealed domain value、RecordAttachment adapter、owner-specific binding 与领域 Analysis API。
- Record host 显式安装 SDK 导出的 opaque installation；Plugin mount 不自动安装 migration trust。
- Analysis 作者调用 SDK 的 `projectGpuEnergy()` 等领域函数，并保留 denominator、穷尽状态、issues 与 refs。
- Report 作者只声明 SDK 导出的领域 input，并消费 closed values；Report callback 不取得 reader 或 migration。
- Assertions、Diff、OTel Timing 与其它内建功能使用不导出的 official adapter 和同形 binding。

## 范围

本方向包含：

- 一次声明完整版本族、current adaptation、projection 与相邻 migration；
- opaque installation、projector 与 exact adapter 的分权；
- Attempt／Run owner-specific binding 与 Plugin 双 occurrence；
- total producer obligation、reservation、tracked command、poison 与 seal barrier；
- blob target、plain-data snapshot、显式 migration 与 official namespace；
- Effect v3 Scope 中的 producer acquire／seal／release。

它不增加 `t.use()`、keyed context augmentation、service locator 或公共 `record()`。同一 family 的多次领域事件由领域
collector 累积并封口；Record 不是 append log。

本目标的 public export map 不包含 `defineJsonRecordAttachment`、`makeRecordAttachmentWrite`、
`RecordAttachmentWrite` 或 draft `.record()`。这些机制只可留在 Record package 内部，作为 adapter command kernel 的
实现材料；它们不是 adapter SPI 的替代入口。raw projector constructor 同样只属于 `/record/adapter` 的 SDK 边界，
Analysis 与 Report 只接收领域命名的 projection declaration。

## 入口

- [Library](library.md) —— adapter、installation、owner-specific binding、target、projection 与 migration 语法。
- [Architecture](architecture.md) —— authority、identity、中立 kernel、Plugin occurrence 与 official 边界。
- [Lifecycle](lifecycle.md) —— total obligation、Scope、seal／release、poison 与 publication。
- [CLI](cli.md) —— installation registry、显式 migration、Git 恢复点与 sentinel。
- [Use Case](use-case/README.md) —— 官方 OTel 与用户 GPU 扩展两套纵向用例，以及 SPI 的机械切片。
