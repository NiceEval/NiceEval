# Reports：把 AnalysisSample 变成可交付视图

Reports 把 [`AnalysisSample`](../sample/README.md) 和按需读取的 Record Channels 变成终端输出、持续热重载的本机页面或可分享的静态站。它负责 typed projection 之后的计算与呈现，不拥有评估事实。

```text
RecordReader
    │ analysis selection（Core only）
    ▼
AnalysisSampleHandle
    │ RecordProjection declarations
    ▼
ProjectedSample
    │ Calculation + PageFamily
    ▼
immutable ReportExecution
    ├─ show
    ├─ view revision
    └─ static export
```

## 核心心智

- analysis selection 决定成员范围与 expected-slot 分母；
- Channel projector 把一个 owner 的一个 recorded payload 形成 typed view；
- Calculation 跨 owner 聚合，例如通过率、成本或诊断分布；
- Page 与 PageFamily 把这些结果包装成闭合语义树；
- host 把同一棵树渲染成 text、web 或 static HTML。

通过率不是 Record 字段，也不是 Channel projector。它由 Report Calculation 从完整分母与 Verdict projections 计算。

Report 不重新选择历史、不判断 reuse，也不读取当前源码。source viewer 沿 Sample 中已冻结的 exact origin reference 读取 `niceeval.sources`；origin Run 不会因此加入分析分母。

## 作者只声明数据与包装结果

Report 作者用 `attemptSlotProjection(projector)`、`selectedRunProjection(projector)` 或 `attemptOriginRunProjection(projector)` 声明数据。然后用 `defineCalculation`、`definePage`、`definePageFamily` 和 `defineDownload` 包装结果。

作者不会看到 Record path、reader、底层 owner request、宿主去重表、compiled plan 或 route-expansion phase。宿主从 definition 与 Sample 穷尽全部 I/O，按 owner + private projector token 去重，并在 reader Scope 内一次形成自包含输入。

projected values 可以展开动态页面：

- 每个 Assertion 一页；
- 每个 conversation turn 或 tool call 一页；
- 每个 diagnostics category 一页。

它们不能追加新的 Channel I/O。这样 route 可以动态，数据依赖仍然静态闭合。

## 完整度与局部失败

每个 Calculation 声明 `allow-partial` 或 `require-complete`。例如 100 个分母项只有 20 个成功采集 commands 时，页面写 `20 / 100 · partial`，不能把 20 当成完整分母。

未请求的坏 Channel 不读取也不影响 execution。被请求的 unavailable、unsupported、invalid、collection partial 与 decoding partial 保留为不同状态。一个输入只影响声明它的 consumer。

作者 callback 的 throw 是 `execution-failed`，不是 Record input invalid。参数面不提供平台 capability，但 JavaScript module 仍是受信任代码，不是沙箱。

## 页面、view 与静态分享

Page 返回 `niceeval.report-document/v1` 闭合语义树，不返回任意 JSON、HTML 或 DOM。Web、terminal text 与 static HTML 都从同一棵树派生，不维护独立的页面文字副本。

一个 `ReportExecution` 永远 immutable，并且每个 projection、Calculation、Page 与 Download 最多执行一次。

`niceeval view` 保留热重载：长期 `ReportViewSession` 在 watched input 改变时构造新的 immutable revision，成功后原子切换；失败时继续服务最后一个成功 revision 并显示 rebuild error。它不会修改旧 execution。

static export 只消费一个 execution。它在同级 staging directory 写完整 closure，以平台 atomic no-replace directory publish 让目标一次出现。目标已存在或平台不能证明该能力时 fail closed。

## 范围

Reports 包含：

- typed `RecordProjection` declarations、穷尽 logical entries 与一次 unique-owner projection；
- Calculation、fixed Page、value-dependent PageFamily 与 Download；
- closed semantic report tree；
- terminal show、本机热重载 view 与自包含 static export；
- partial、unavailable、unsupported、invalid 与 execution-failed 的一致反馈。

Reports 不包含：

- Record 格式、写入、migration、reuse planning 或 analysis selection 算法；
- 浏览器端任意 script、style、font、worker、WASM、网络 URL 或路径 loader；
- 不受信任 JavaScript module 的安全沙箱；
- durable Report result、snapshot、revision 或第二种 Record。

## 入口

- [Architecture](architecture.md)：分层、静态数据依赖、动态页面、热重载与不变量。
- [Library](library.md)：作者 DSL、Effect host、semantic tree 与 typed errors。
- [CLI](cli.md)：`show`、`view` 与 `view --out`。
- [Calculations](calculations.md)：完整度、分母和聚合算法。
- [Use case](use-case/README.md)：常见报告任务。
- [Reference](reference/README.md)：外部材料的使用边界。
