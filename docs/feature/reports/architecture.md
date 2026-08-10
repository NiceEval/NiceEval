# Reports 架构

本页定义 Reports 的数据边界与运行时序。公开调用形状见 [Library](library.md)，用户命令见 [CLI](cli.md)。

## 单向数据流

```text
RecordReader
    ↓ analysis projector
core-only AnalysisSample
    ↓ createReportScope / definition.plan
ReportPlan
    ↓ buildReportInput
ReportInput
    ↓ executeReport（一次）
ReportExecution
    ├─ view
    └─ static export
```

analysis projector 只选择 Run、形成 `AnalysisSample` 分母并验证 Member 与 Attempt 核心。plan 只看完整 core-only slots，先穷尽页面、Calculation、Download 与各自 inputs。Record→Reports composition adapter 才按这些 inputs 读取通道。

Report 定义、Calculation、页面、下载、本机 runtime 与静态 runtime 都不接收 reader、路径、原始字节或 `ExecutionProjection`。它们不能反向打开 Record，也不能写回 `AnalysisSample`。

## 两类边界

`buildReportInput({ record, sample, plan })` 是唯一 composition boundary。它可以接收 `RecordReader`，但纯 Report runtime 不可以。它按 owner 与 requirement id 构造内部 Run/Attempt fact matrix，保留每项 `ChannelRead`。matrix 由未导出的 brand 隔离；consumer 只能通过宿主给自己的受控方法读取已声明 requirement。

用户代码只有两个边界：纯 <code>plan()</code>，以及一次 <code>executeReport()</code>。build 不调用用户 parser。execute 先对每个 owner 与 requirement 组合调用一次 custom parser，再让 Calculation、Page.render 与 Download.build 各执行至多一次，形成穷尽 <code>ReportExecution</code>。之后 view 与 export 只写入既有结果，不重算、也不重新解码 facts。

## 先列输入，再读取

`ReportScope.slots` 保留 included、not-recorded、invalid、excluded 的完整分母。included slot 还保留 Attempt identity、origin、locator 和 Member kind，所以 plan 可以穷尽详情 route，不需要业务 facts。

每个 FactRequirement 都声明唯一 id、`run | attempt` owner、语义 name 与内建或 custom-json source。不同 requirement 对象不能复用 id。builder 在读取 Record 前跨全部 consumer 验证 id，再合并 inputs，只读取唯一 owner identity 与 requirement id 的并集。

Run requirement 对每个已选 Run 建立 read，即使该 Run 没有 included slot。Attempt requirement 只对 included slot 的 Attempt 建立 read。consumer 的 <code>readRun()</code> 与 <code>readAttempt()</code> 同时核对 inputs、owner 和目标范围，不能借公开 matrix 读取其它 requirement。

Run requirement 还可通过 <code>readOriginRun(includedSlot, requirement)</code> 读取该 Attempt 的 origin Run。builder 在 operation lock 内预取这些 origin facts；origin Run 不进入 `AnalysisSample` 分母，也不能被 Report 枚举。source viewer 固定用这条边读取 <code>niceeval.sources</code>，所以 carried 与 accepted 共享源 Run 的当前源码快照，不复制源码，也不回退读取当前 worktree。

这保证一个未请求的坏通道不会进入本次 ReportInput。一个被请求的坏通道也只进入相应 fact read，不让其它 requirement 消失。

## 通道与 consumer 状态

reader 返回 `read`、`unavailable`、`unsupported` 或 `invalid`。`read` 另有 durable collection 与 decoding 两条完整度轴。

| 状态 | composition 与执行 |
|---|---|
| `read` 且两轴 complete | consumer 可以按声明计算。 |
| `read` 且任一轴 partial | `allowPartial` 可计算，但必须显示 observed、denominator 与 partial；`requireComplete` 返回 unavailable。 |
| `unavailable` | consumer 明确显示未采集或不适用。 |
| `unsupported` | consumer 明确显示当前请求没有可用 decoder。 |
| `invalid` | 对应 consumer 为 `input-invalid`，保留 requirement、channel 与 issues；其它 consumer 继续。 |

用户 parser 只在 execute 中运行，并只接收 Record transport 已验证的 `CustomFactDocument`。每个 owner 与 requirement 组合调用一次；它失败也是 requirement/consumer-local，不接触 bytes、descriptor、路径或 blob。

输入问题与用户代码问题分开。宿主在 declared input 或 Calculation 为 input-invalid 时不调用下游用户函数，形成 `input-invalid`；上游 Calculation 或当前用户函数执行失败时形成 `execution-failed`。本机 view 为失败 route 显示内建具名页面。

## Calculation 与分母

Calculation 从完整 `AnalysisSample` 分母计算 observed，不得把有值子集改成分母。

```text
commands.checked
observed:    20
denominator: 100
state:       partial
```

`allowPartial` 可以显示 `20 / 100 · partial`。`requireComplete` 只有 durable collection 与 decoding 都 complete 时才可用。数字、图表、文字和下载都消费同一个 CalculationResult，不分别重算。

## 页面与下载

普通页与参数化页都在 plan 阶段产生确定 route。参数化页的每个参数组合必须先列出；浏览器地址不能创造新实例或 fact 请求。

页面只返回结构化 `ReportPageModel` 与 `textAlternative`。用户 Report 不能注入浏览器脚本、CSS、font、worker、WASM、网络资源或任意文件路径。Download 在 execute 阶段完整形成 bytes。需要大内容的 Record 数据由具名内建/专用 Attempt channel 与 blob 提供，不由 generic `ctx.fact()` 或 Report runtime 读路径。

颜色、图形或悬停提示不能是 partial、unavailable、unsupported 或 invalid 的唯一表达。复杂图表必须有等价表格或文字摘要。

## 自包含静态 export

静态 export 按以下顺序完成：

1. 接收已经形成的 `ReportExecution`，不重跑用户代码。
2. preflight 全部 Calculation、Page 与 Download result；任一 input-invalid 或 execution-failed 就整体失败。
3. 穷尽构造 route 与全部输出 path，验证 namespace、逐 byte ASCII lowercase key、前缀和冲突规则。
4. 确认目标目录不存在，并 exclusive create 本次 owner 的同级临时目录。
5. 写入已经生成的页面、host-data、downloads，以及当前 exporter 内建的精确 runtime、基础样式与字体。
6. 写入固定 `manifest.json`，验证 route 映射与除 manifest 自身外的每个文件一一对应。
7. 以同一文件系统的一次目录 rename 让不存在的目标完整出现。

export 不替换已有目录。要替换已部署站点，调用方先导出到新目录，再让部署平台切换版本；Reports 不承诺跨平台原子替换非空目录。

临时目录只归本次随机 128-bit owner。可处理失败删除本 owner 临时目录；崩溃 orphan 保留，不被后续 export 领养或自动删除。

`manifest.json` 本身不列入 entries，是穷尽规则的唯一例外。manifest 持久保存 route → pagePath/hostDataPath，并列出每个其它普通文件。断网 runtime 只读取这些文件，不访问网络、源 Record、调用进程或未来 NiceEval。

page 与 host-data 路径只由 plan 顺序产生，内建资源只在 <code>runtime/</code>，Download 只在 <code>downloads/</code>。route 与输出 path 都使用 Library 定义的 canonical ASCII 段和 240-byte 上限；比较 key 固定为逐 byte ASCII lowercase。完整集合在创建临时目录前拒绝非法段、absolute、exact/key 重复，以及基于同一 key 的目录前缀冲突。浏览器地址不能生成计划外页面。

## 不变量

- `AnalysisSample` core 与 Report facts 不混在一个构造阶段。
- buildReportInput 是唯一接触 reader 的 Reports composition adapter。
- Record operation lock 从 analysis projector 开始一直持有到 ReportInput 完整形成；ReportExecution 不再打开 Record。
- 用户代码只在 plan 与一次 execute 中运行。
- 页面和 Calculation 只因自己声明的 inputs 受影响。
- view 可以局部显示失败；export 对同一 execution 全量拒绝失败。
- 用户 Report 不提供任意浏览器资源或路径 loader。
- 静态目标必须不存在，成功时一次出现完整目录。
- Report 不生成 proof、snapshot、revision 或让未来 NiceEval 重开源事实的引用。
