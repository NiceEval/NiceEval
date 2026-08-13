# Reports：把运行结果变成可交付视图

Reports 把 Record 中的运行结果变成终端输出、热重载页面或可分享的静态站。公开作者面是 0.12 经典面：`defineReport({ title, pages })`、`render(sample)`、`aggregate` / `passRate` / `costUSD` / `experiment`、`Section`、带 `title` / `logo` 的 `Hero`，以及 `input={sample}`。`Sample` 类型从 `niceeval/record` 导入。MemoryBench 的 classic.tsx 不要求 `defineComponent` 或 `ctx.scope`。低层 projection API 继续存在，供需要自定义投影与计算的作者使用。

```text
opaque Record
    │ CLI 内部 selection / projection
    ▼
AnalysisSample
    ├─ classic facade：固定 projection plan
    │  （evaluation plan / verdict / usage / timing）
    └─ 低层 projection API：RecordProjection 声明
    ▼
深冻结 Sample / ProjectedSample
    │ page.render(sample) → 受控 JSX → 闭合 ReportDocument
    ▼
closed semantic validation
    ▼
immutable ReportExecution
    ├─ show
    ├─ view revision
    └─ static export
```

## 核心心智

- 经典面是唯一公开作者入口的默认形状：`defineReport({ title, pages })`、`render(sample)` 与受控 JSX；
- facade 先声明固定 projection plan，host 只投影一次，构造深冻结 `Sample`，再调用 `page.render(sample)`；
- 展开结果进入同一个 closed semantic validation 与 `ReportExecution`，show、view 与 static export 只消费它，不存在第二套数据或渲染真相；`classic-dashboard` 只是 presentation profile；
- 受控 JSX 不是 raw React / DOM：原生 tag、任意 unbranded component、head、script / style / font / worker / WASM、raw HTML 与自定义 text / web 双面 renderer 都拒绝；
- 低层 projection API 继续存在：作者用 `RecordProjection` 声明数据，用 `defineCalculation`、`definePage`、`definePageFamily`、`defineDownload` 包装结果；
- trusted TS module 本身不是 sandbox；NiceEval 只保证不授予 reader、Effect、Record root / path 与 append-I/O capability。

通过率不是 Record 字段，也不是 Attachment projector。它由 facade 的 `passRate` 从投影结果按两级分母派生，口径属于官方 Calculation value。

## 作者只声明数据与包装结果

classic facade 作者从 `niceeval/report` 导入 `defineReport`、内置组件与 `aggregate` / `passRate` / `costUSD` / `experiment`，并从 `niceeval/record` 导入 `Sample` 类型。页面 `render(sample)` 读取这份深冻结样本，不接触 reader、path、root 或 Effect。

低层投影作者从同一入口导入 `RecordProjection` factory、`defineCalculation`、`definePage`、`definePageFamily` 与 `defineDownload`。作者看不到 reader、path、raw family/value、owner lookup、compiled plan 或 route expansion。宿主从 definition 与 Sample 在 I/O 前闭合全部投影依赖，每个投影最多执行一次。

projected values 可以展开动态页面：

- 每个 Assertion 一页，route 依赖 Assertions Attachment 的 durable `entryId`；
- 每个 conversation turn 或 tool call 一页；
- 每个 diagnostics category 一页。

PageFamily 只能从已声明的 projected / calculated 内存值展开 route，不能追加新的 Attachment I/O。

## 完整度与局部失败

每个直接消费 projection 的低层 Calculation、Page、PageFamily 或 Download 声明 `allow-partial` 或 `require-complete`。未请求的坏 Attachment 不读取也不影响 execution。

Recorded-data problem 允许成功呈现，并进入不可关闭的 problems surface。它包括 unavailable、migration-required、migration-unavailable、unsupported 与 invalid。projector / 作者 callback defect 是该 consumer 的 execution problem，其它页面继续；static export 对任一 execution problem fail closed。

只有 `migration-required` 提示运行 `niceeval migrate`；`migration-unavailable` 只呈现原因，不提示迁移命令。

classic facade 的固定投影与 `passRate` 沿用同一套状态语义：skipped / missing 不伪造进分子，coverage 显式呈现；缺失 cost / timing 不补 0。

## 一次 execution、热重载与静态分享

一个 `ReportExecution` 永远 immutable，每个 projection、Calculation、Page、PageFamily instance 与 Download 最多执行一次。terminal JSON、live view 与 static export 消费同一个 `ReportExecution`。

`niceeval view` 保留热重载：每次 rebuild 产生一份新的 fixed `ReportExecution`，成功后原子替换 last-good，失败保留 last-good 并显示问题。loader 与 watcher 的具体实现属于 Node host，不进入本契约。

static export 先预检，再写出完整 closure，最后写入完成标记。中断可能留下未完成的目录；host 以缺失的完成标记识别并提示删除。本契约不承诺原子目录发布。

## 范围

Reports 包含：

- classic facade：`defineReport({ title, pages })`、`render(sample)`、受控 JSX、内置组件与 `aggregate` / `passRate` / `costUSD` / `experiment` / `rollup`；
- `standardExperimentPage` / `standardAttemptPage`：按 experiment id 与 attempt locator 展开的可导航详情页；
- 低层 typed `RecordProjection` declarations、穷尽 `ProjectedSample` 与一次 unique projection；
- Calculation、fixed Page、value-dependent PageFamily 与 Download；
- closed semantic report tree（含 Hero、summary、柱状图、散点与 Experiment / Eval / Attempt 层级导航）；
- terminal show、热重载 view 与 self-contained static export；
- unavailable、unsupported、invalid 等数据问题与 data-unavailable、execution-failed 的一致反馈。

Reports 不包含：

- Record 格式、写入、migration、reuse planning 或 analysis selection 算法；
- 浏览器端任意 script、style、font、worker、WASM、raw HTML 或路径 loader；Hero 外链只接受绝对 https，host 只序列化不 fetch；
- 不受信任 JavaScript module 的安全沙箱；
- durable Report result、snapshot、revision 或第二种 Record；
- durable metadata profile attachment；future durable profile 属于边界，不是当前承诺；
- Worker、RPC、bundler、wire codec 或原生原子发布等 host 实现细节。

## 入口

- [Architecture](architecture.md)：分层、投影计划、selection-origin、静态数据依赖与不变量。
- [Library](library.md)：classic facade、低层作者 DSL、semantic tree 与 typed errors。
- [Calculations](calculations.md)：完整度、分母与聚合算法。
- [CLI](cli.md)：`show`、`view` 与 `view --out`，project-current 与 `--run` 的表现。
- [Use case](use-case/README.md)：常见报告任务。
