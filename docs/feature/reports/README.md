# Reports：把 AnalysisSample 变成可交付视图

Reports 把 [`AnalysisSample`](../sample/README.md) 与官方 opaque projection 变成终端输出、热重载页面或可分享的静态站。它负责 projection 之后的计算与呈现，不拥有评估事实。

```text
opaque Record
    │ CLI 内部 selection / projection
    ▼
AnalysisSample
    │ niceeval/report declarations
    ▼
ProjectedSample
    │ Calculation + Page / PageFamily
    ▼
immutable ReportExecution
    ├─ show
    ├─ view revision
    └─ static export
```

## 核心心智

- analysis selection 决定成员范围与 Sample-wide slot denominator；
- 官方 projector 把内部 Attachment 形成作者可消费的 typed view；作者不能定义 raw family reader；
- Calculation 跨 owner 聚合，例如通过率、成本或诊断分布；`observed` 与 `denominator` 由 Calculation value 自己返回；
- Page 与 PageFamily 把这些结果包装成闭合语义树；
- host 把同一棵树渲染成 text、web 或 static HTML。

通过率不是 Record 字段，也不是 Attachment projector。它由 Calculation 从投影结果派生，口径属于 Calculation value。

## 作者只声明数据与包装结果

Report 作者用 `attemptSlotProjection(projector)`、`selectedRunProjection(projector)` 或 `attemptOriginRunProjection(projector)` 声明数据。然后用 `defineCalculation`、`definePage`、`definePageFamily` 和 `defineDownload` 包装结果。

作者只从 `niceeval/report` 导入 Report DSL、Theme、官方 projector、声明 constructor 与必要的纯数据类型。
作者看不到 reader、path、raw family/value、owner lookup、compiled plan 或 route expansion。宿主从 definition 与 Sample 在 I/O 前闭合全部投影依赖，每个投影最多执行一次。

projected values 可以展开动态页面：

- 每个 Assertion 一页，route 依赖 Assertions Attachment 的 durable `entryId`；
- 每个 conversation turn 或 tool call 一页；
- 每个 diagnostics category 一页。

PageFamily 只能从已声明的 projected / calculated 内存值展开 route，不能追加新的 Attachment I/O。

## 完整度与局部失败

每个直接消费 projection 的 Calculation、Page、PageFamily 或 Download 声明 `allow-partial` 或 `require-complete`。未请求的坏 Attachment 不读取也不影响 execution。

Recorded-data problem 允许成功呈现，并进入不可关闭的 problems surface。它包括 unavailable、migration-required、migration-unavailable、unsupported 与 invalid。projector / 作者 callback defect 是该 consumer 的 execution problem，其它页面继续；static export 对任一 execution problem fail closed。

只有 `migration-required` 提示运行 `niceeval migrate`；`migration-unavailable` 只呈现原因，不提示迁移命令。

## 一次 execution、热重载与静态分享

一个 `ReportExecution` 永远 immutable，每个 projection、Calculation、Page、PageFamily instance 与 Download 最多执行一次。

`niceeval view` 保留热重载：每次 rebuild 产生一份新的 fixed `ReportExecution`，成功后原子替换 last-good，失败保留 last-good 并显示问题。loader 与 watcher 的具体实现属于 Node host，不进入本契约。

static export 先预检，再写出完整 closure，最后写入完成标记。中断可能留下未完成的目录；host 以缺失的完成标记识别并提示删除。本契约不承诺原子目录发布。

## 范围

Reports 包含：

- typed `RecordProjection` declarations、穷尽 `ProjectedSample` 与一次 unique projection；
- Calculation、fixed Page、value-dependent PageFamily 与 Download；
- closed semantic report tree；
- terminal show、热重载 view 与 self-contained static export；
- unavailable、unsupported、invalid 等数据问题与 data-unavailable、execution-failed 的一致反馈。

Reports 不包含：

- Record 格式、写入、migration、reuse planning 或 analysis selection 算法；
- 浏览器端任意 script、style、font、worker、WASM、网络 URL 或路径 loader；
- 不受信任 JavaScript module 的安全沙箱；
- durable Report result、snapshot、revision 或第二种 Record；
- Worker、RPC、bundler、wire codec 或原生原子发布等 host 实现细节。

## 入口

- [Architecture](architecture.md)：分层、静态数据依赖、动态页面、热重载与不变量。
- [Library](library.md)：作者 DSL、Effect host、semantic tree 与 typed errors。
- [Calculations](calculations.md)：完整度、分母与聚合算法。
- [CLI](cli.md)：`show`、`view` 与 `view --out`。
- [Use case](use-case/README.md)：常见报告任务。
