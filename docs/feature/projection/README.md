# Projection：Report 的 opaque 数据声明

Projection 位于 [AnalysisSample](../sample/README.md) 与 [Report](../reports/README.md) 之间。
Report 作者声明需要哪一个官方 projector、以哪种逻辑 access 对齐 Sample；CLI 的内部 host
负责读取 RecordAttachment 并形成自包含 `ProjectedSample`。

```text
AnalysisSample + public projection declaration
                         │ internal host
                         ▼
                  ProjectedSample
                         │
                         ▼
               Calculation / Page
```

作者拿不到 raw Attachment family、payload/value、reader、path 或 direct projection runtime，
也不能定义第三方 raw Record projector。未来的自定义持久事实若开放，会通过独立的高层
Eval / Experiment / Plugin 能力设计，不会重新公开 Record reader / writer。

## 三种逻辑访问

- `attemptSlotProjection(projector)`：与 `sample.slots` 一一对齐；included slot 使用它引用的 Attempt。
- `attemptOriginRunProjection(projector)`：仍与 slot 一一对齐；included slot 使用 Attempt 的 origin Run。
- `selectedRunProjection(projector)`：与 `sample.runs` 一一对齐。

constructor 只接受 NiceEval 提供的 opaque `RecordAttachmentProjector`，例如 verdict、score、
evaluation、eligibility、sandbox、observability 与 sources projectors。projector 的 family、
decoder 和执行入口均由包内部拥有。

## 穷尽结果

slot projection 的 entry 是 `excluded`、`not-recorded`、`core-invalid` 或
`attachment-result`。Attachment result 再穷尽表达 available、unavailable、
migration-required、migration-unavailable、unsupported 与 invalid。数据问题留在值中，
不会把整个 Sample 改成 core-invalid。

`ProjectedSample.coverage` 分开报告 Sample slot、逻辑 entry 与 Attachment result 状态。
Sample `denominator` 只表示 Sample-wide slot denominator；Calculation 的 `observed` 与
`denominator` 由其领域值明确返回，host 不从 transport coverage 猜测。

## 范围

公开 Projection 包含：

- 官方 opaque projectors 与三种 declaration constructors；
- 穷尽 `ProjectedSample`、entry、coverage 与 source tree 等纯结果类型；
- 不触发 I/O 的纯 assembler。

内部 host 拥有 raw projector factory、Attachment family/value、reader-bound selection、
direct Effect runtime、owner lookup、limits 与 I/O errors。

## 入口

- [Library](library.md)：公开 TypeScript 声明与官方 projectors。
- [Sample](../sample/README.md)：expected-slot 分母与纯 Sample。
- [Record](../record/README.md)：opaque 持久化资产与内部不变量。
- [Reports](../reports/README.md)：怎样形成 ReportExecution。
