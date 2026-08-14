# Reports：把运行结果变成可交付视图

Reports 把 Record 中的运行结果变成终端输出、热重载页面或可分享的静态站。公开作者面是 0.12 经典面：`defineReport({ title, pages })`、`render(sample)` 与 `defineComponent((props, ctx) => ...)`。
它还包括 `aggregate` / `passRate` / `costUSD` / `experiment`、`Section`、带 `title` / `logo` 的 `Hero`，以及组件内的 `ctx.scope`。`Sample` 类型从 `niceeval/record` 导入；内置组件既可使用当前 scope，也可由 `input={sample}` 显式指定。低层 projection API 继续存在，供需要自定义投影与计算的作者使用。

```text
opaque Record
    │ CLI 内部 selection / projection
    ▼
AnalysisSample
    ├─ classic facade：固定 projection plan
    │  （evaluation plan / verdict / kind-gated score / usage / timing）
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
- classic 固定 sample pages 的稳定 identity、声明顺序、本地化标题、exact route 与导航可见性随同一份 `ReportExecution` 闭合；PageFamily 只提供详情 route，不进入顶部导航；
- 受控 JSX 不是 raw React / DOM：原生 tag、任意 unbranded component、head、script / style / font / worker / WASM、raw HTML 与自定义 text / web 双面 renderer 都拒绝；
- 低层 projection API 继续存在：作者用 `RecordProjection` 声明数据，用 `defineCalculation`、`definePage`、`definePageFamily`、`defineDownload` 包装结果；
- trusted TS module 本身不是 sandbox；NiceEval 只保证不授予 reader、Effect、Record root / path 与 append-I/O capability。

通过率和总分都不是 Record 字段。facade 的 `passRate` 只聚合 Pass Eval；`totalScore` 对
Score Eval 先在每道 Eval 内取 complete earned score 的 Attempt 均值，再跨 Eval 求和。
纯 Score 范围只显示成绩并按总分排序，不把历史 Verdict claim 显示成 passed / failed；
混合范围并排显示两种主读数。

Score 投影按每个 Slot 的 Evaluation Plan 判定是否必需：Pass Eval 没有 Score
Attachment 是不适用，不形成 data problem；Score Eval 缺失或损坏 Score 仍是问题。
Evaluation kind 无法判定时不猜测为 Pass，Score 的适用性保持 unresolved 并进入 problems surface。

## 作者只声明数据与包装结果

classic facade 作者从 `niceeval/report` 导入 `defineReport`、内置组件与 `aggregate` / `passRate` / `costUSD` / `experiment`，并从 `niceeval/record` 导入 `Sample` 类型。页面 `render(sample)` 读取这份深冻结样本，不接触 reader、path、root 或 Effect。

低层投影作者从同一入口导入 `RecordProjection` factory、`defineCalculation`、`definePage`、`definePageFamily` 与 `defineDownload`。作者看不到 reader、path、raw family/value、owner lookup、compiled plan 或 route expansion。宿主从 definition 与 Sample 在 I/O 前闭合全部投影依赖，每个投影最多执行一次。

projected values 可以展开动态页面：

- 每个 Assertion 一页，route 依赖 Assertions Attachment 的 durable `entryId`；
- 每个 conversation turn 或 tool call 一页；
- 每个 diagnostics category 一页。

PageFamily 只能从已声明的 projected / calculated 内存值展开 route，不能追加新的 Attachment I/O。

## 完整度与局部失败

每个直接消费 projection 的低层 Calculation、Page、PageFamily 或 Download 声明 `allow-partial` 或 `require-complete`。未请求或经 package-owned dependency 确认为不适用的坏 Attachment 不影响 execution；依赖无法判定时仍形成问题。

Recorded-data problem 允许成功呈现，并进入不可关闭的 problems surface。它包括 unavailable、migration-required、migration-unavailable、unsupported 与 invalid。projector / 作者 callback defect 是该 consumer 的 execution problem，其它页面继续；static export 对任一 execution problem fail closed。

只有 `migration-required` 提示运行 `niceeval migrate`；`migration-unavailable` 只呈现原因，不提示迁移命令。

classic facade 的固定投影与 `passRate` 沿用同一套状态语义：skipped / missing 不伪造进分子，coverage 显式呈现；缺失 cost / timing 不补 0。

## 一次 execution、热重载与静态分享

一个 `ReportExecution` 永远 immutable，每个 projection、Calculation、Page、PageFamily instance 与 Download 最多执行一次。terminal JSON、live view 与 static export 消费同一个 `ReportExecution`。

`niceeval view` 保留热重载：每次 rebuild 产生一份新的 fixed `ReportExecution`，成功后原子替换 last-good，失败保留 last-good 并显示问题。loader 与 watcher 的具体实现属于 Node host，不进入本契约。

classic live view 把当前 execution 中可导航的固定 sample pages 显示为一个可访问的 tab set；切换 tab 只切换这份 revision 已经渲染的页面。Experiment Table 的 Experiment → group/eval → Attempt 是 closed semantic tree 的显式父子拓扑，live 与 static 共用原生 disclosure。static 禁用 JavaScript 仍能用键盘展开并沿普通 exact-route href 打开详情。

live host 只在 canonical href 之上做渐进增强：点击 Experiment 或 Attempt 可在具名 modal dialog 中呈现同一 revision、同一路由的 `ReportDocument`；关闭后焦点回到触发链接，当前 tab 与展开状态不丢失。直接请求、新标签页与 static export 始终使用同一个 href。revision 变化时 host 不混合旧触发页与新详情页。

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
- 作者注入的任意 script、style、font、worker、WASM、raw HTML 或路径 loader；Hero 外链只接受绝对 https，host 只序列化不 fetch。package-owned live enhancement 只能消费当前 closed execution，不能成为第二套数据或业务 renderer；
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
