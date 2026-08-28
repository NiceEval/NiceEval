# Insight 架构

## 完整 SQLite 读取链

Insight 的数据源是 Record SQLite，不是为 View 生成的业务 JSON。operational source 可能仍在 WAL
模式写入，因此浏览器永不直接打开 `<project>/.niceeval/record.sqlite`。Record Host 先按 Record 的
Snapshot 流程形成一个一致、完整、sealed-only 的 `RecordSnapshot`。

```text
operational Record SQLite
  → Record Host Snapshot barrier / backup / validation
  → RecordSnapshot SQLite bytes
  → loopback session-protected GET
  → sqlite-wasm Worker connection / facts adapter
  → internal Inspection selector + shared protocol decoder
  → React routes and components
```

`RecordSnapshot` 的职责只有取得可一致打开的 SQLite image。它不为 Insight 重排 table、派生另一套
schema、删改业务字段、转换成 JSON，或成为脱敏交付格式。Snapshot 内含的 sealed Record 内容仍按 Record
的分享风险与 hostile-input 验证规则处理。

Host 完成 Snapshot 后关闭 source-side 读取资源。浏览器只持有 Snapshot 的一个只读 generation，不持有
operational database、Node connection、WAL handle 或 Record Host capability。

## 轻量 loopback Host

CLI 父进程只负责以下运行时边界：

- 定位 live Record 或验证 `--record` source，并形成当前 `RecordSnapshot`；
- 服务 Vite build 的 SPA assets 与受保护的 SQLite GET；
- 建立、校验与失效本机 session，并限制 listener 为 `127.0.0.1`；
- 发现 operational sealed publication、协调用户确认后的 refresh，并管理浏览器与进程生命周期。

SQLite GET 是读取完整 Snapshot bytes 的受保护资源，不接受 SQL、selector、formula、业务 operation 或
分页参数。Host 对每项请求校验 session、Host 与 Origin。未通过校验的请求不能取得 assets 之外的 SQLite；
credential 不进入 RecordSnapshot、页面数据、lifecycle event 或 Preview。

因此 loopback Host 不是业务 REST API，也不是 Report service。它不返回业务 DTO，更不在 Node 侧按 route
计算指标、比较或调试详情。

## 浏览器数据库与 repository

sqlite-wasm Worker 独占浏览器中的 SQLite connection、statement lifecycle 和 Snapshot 打开/关闭。它在一个
固定的 worker port 上以 source adapter 读取 facts，再调用 browser-neutral internal selector。
`niceeval/inspection` 提供由 16-operation registry 派生的 request/document Schema、类型与 decoder；Web 与 CLI、
Testkit 共享这份协议 owner，不建立浏览器 DTO 或 client-local decoder。

Inspection 拥有 Overview 指标、Experiment 比较、层级 table 与 Run/Attempt debugger 所需的固定 query
definition 和 result builder。Browser adapter 把 pinned facts 交给 selector；repository 只另外拥有 Experiment
默认选择与页面导航所需的轻量状态。它不请求 Node 补算，也不把一份 JSON projection 当作第二真源。

React 组件只调用具名 repository hook 或 controller，并呈现其 typed result。组件、route loader 与 language
catalog 都不得嵌入 SQL、打开 SQLite、拼业务查询，或得到通用 SQL executor。这样 query 语义与 decoder
集中在一个可审计位置，UI 不会逐页漂移。读取或解码失败时，UI 显示 typed issue 并保留已有 generation；
它不会改用 raw store、Node projection、JSON 或旧 cache。

Worker 与 repository 都是只读面。它们不写 Snapshot、不打开 live Record，也不提供浏览器 SQL console。
当前 Record schema 先由 Record Host 的验证与迁移路径确认。`not-recorded`、`partial`、`unavailable`、
`truncated` 与 `omitted` 是 Inspection result 的领域结果，不是前端为旧 schema 保留的兼容分支。

## SPA 与路由

Insight 是常规 React 19 + React Router + Tailwind 4 + Vite SPA。Vite 只构建浏览器 assets；浏览器没有 SSR、
RSC、Route Handler、child server 或 IPC。

根路由在 repository 给出的稳定 Experiment 顺序中选择默认项。显式 `Experiments` selector 写入 URL，
而 `Language` 独立保存界面 locale。Header 固定为 selector 在前、语言选择在后。

Overview 显示 Summary cards、指标、Experiment 比较和
Experiment → 可选 Eval 路径组 → Eval → Attempt table。Run identity 是 Attempt member 的 selected provenance，
不构成独立层级。Run 与 Attempt route 在从 Overview 打开时保留 background location，以
drawer/modal 呈现。没有 background location 的深链接与硬加载改用同一详情内容，而不是空白 drawer。

Run/Attempt debugger 使用 repository 的连续读取结果呈现 source、assertions、trajectory、tool input/output、
timeline、usage、commands、diagnostics 与 diff。缺失、部分采集、不可用、截断与省略的领域结果保持其状态、理由和
边界；界面不能把它们填补为成功或完整。

Overview route 呈现内部 selector 执行 `{ kind: "overview.get" }` 后的 typed success。Attempt route 先呈现
`attempt.get` 和 `attempt.trace` outline。展开 Assertion 时按 `entryId` 调用 `attempt.assertion.detail`。
展开 conversation item、tool occurrence 或 Sandbox command 时，以 `itemId`、`toolOccurrenceId` 或 `commandId`
调用 `attempt.trace.detail`。React 的数组 index、Turn 次序和折叠卡片位置都不是持久 identity。

Overview 的 member、cell 与 aggregate 三处 score 都只 decode/relabel Inspection 已关闭的 `score.value`。
member 显示 selected Attempt earned 值；cell 显示 eligible Attempt mean；aggregate 显示 child cell score sum。

View 不以 `samples` 相除，也不对 cell 再求 sum。它保留原有 `MetricValue` state、samples、total、basis、issues
与 refs；member／cell 的 `basis` 是 `slot`，aggregate 的 `basis` 是 `eval`。`totalScore` 不存在，不能成为第二
权威字段；`mixed` cell 的 pass members 也不进入 points samples/total。

## generation、刷新与收尾

operational View 可以发现新的 sealed publication，但不会自动混合新旧事实。用户确认 refresh 后，Host
形成下一份完整 `RecordSnapshot`；Worker 打开新 generation、repository 准备完成后，SPA 才原子切换到它。
repository 按 `overview.get` 重新选择每个 logical slot 的 latest member。同 slot 的新 Run member 替换旧 member，
不会在 hierarchy 中同时保留两者。准备失败时，旧 generation 和原页面仍可用。

`--record` 选择的 Snapshot 是固定输入，没有 watcher 或 refresh。SIGINT、SIGTERM 或页面关闭时，Host
停止 listener、失效 session，并关闭当前 Snapshot delivery；Worker 关闭 connection 并释放浏览器内资源。

## Preview 与未来写入 seam

PR Preview 与 `main` 的 dogfood 只加载仓库合成 fixture `record.sqlite` RecordSnapshot 和同一候选 SPA assets。
fixture 是 Preview 唯一的数据输入，不含真实用户 Record、项目路径、credential 或 loopback session。公开
Preview 因而不能代理本机 Host，也不能发现或 refresh 开发者的运行。

这条只读链不是 Playground 的基础写协议。未来若需要写入，Playground 会通过一个另行定义的、仅本机
可访问且经过授权的 API 与 Host 协作；它不会复用 Snapshot GET、Worker query port 或当前 session 来写入。
