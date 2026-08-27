# 功能域 · Machine Inspection 与 Insight

`e2e/report/` 验证安装后 candidate 的两条最终公开面。
`niceeval query discover | explain | run` 交付 machine document。`discover` 是静态 catalog，拒绝
`--record`；`explain` 与 `run` 才绑定 operational Record 或显式 RecordSnapshot。

每个 source-bound document 都带有不泄露路径的
`source.kind + source.sealedCutoffIdentity`。

`niceeval view` 从当前 project 的完整 `RecordSnapshot` 或显式 `RecordSnapshot`
启动第一方 loopback Insight SPA。

测试只从安装后 CLI、HTTP 与真实 Chromium 进入，不读 SQLite table、Record bytes 或源码。

`show` 是固定 Inspection operation 的英文终端读面。`insight`、`view --out` 与 static export
已删除，不保留别名。View 不接受自定义 Page、component、theme、route、renderer 或其它 Report 作者面。`view --json` 的 stdout 只是 `niceeval.view-lifecycle/v1` NDJSON；诊断只写 stderr。

## 公开验收边界

- Machine query 保留固定 operation catalog，同一 request 可以从当前 project 或 `--record <snapshot>` 的 sealed facts 执行。
- `view [--run <id>...] [--record <snapshot>] [--no-open] [--port <port>] [--json]` 只监听 loopback。exact Attempt 从页面
  内的 Run/Attempt 导航进入；locator 保留为数据 identity。`ready` 事件的 URL 携带一次性 fragment credential；换取后使用进程期 session。
- Operational Insight 可发现新封口 Run，用户确认后原子切换完整 Snapshot generation。显式 Snapshot 输入固定 exact Seal，不创建 project watcher，不提供 refresh。
- View 的 en / zh-CN catalog 与语言切换由公开 DOM 验收；machine query / CLI 仍只交付英语协议面，不与浏览器 catalog 共用断言。
- Session data 验证 exact Host、Origin 与 session，并带 `Cache-Control: no-store`。测试从浏览器已实际发出的 request 取得精确边界，再次发送该请求。它不在 fixture 中复制 Host 安全算法或猜测私有 endpoint。
- 启动失败、SIGINT 与 SIGTERM 都回收 reader、server、session、watcher 与子进程。受控停止以唯一 `closed` 终止；SIGKILL 不承诺 terminal event。

## 退役边界

Report Repo 只保留固定 Inspection 与 View 需要的 Playwright runner。

## E2E owner anchors

### show-terminal-review

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Inspection CLI · `niceeval show`](../../../feature/inspection/cli.md#niceeval-show)

`show-cli.test.ts` 是人读终端 Inspection Journey owner。它从安装后 candidate 经真实 CLI 读取已封口
Record，验证默认 Overview、重复 exact `--run`、重复 exact `--experiment`、Attempt 概览与全部五个证据切面。

overview 必须保留 operation 已选的 totals、Experiment summary 与 locator。层级固定为
Experiment → Eval → Attempt。renderer 不得从行数或标量重算 denominator、pass rate、score、
coverage 或 Evidence。

Attempt 概览要给出可执行的 source、execution、timing、usage 和 diff 后续命令。Journey 分别运行
`--source`、`--execution [--expand <stable-id>]`、`--timing`、`--usage` 与 `--diff`。它核对以下人读结果：

- source/Assertion facts；
- execution 有界 outline 及其 `itemId` / `toolOccurrenceId` / `commandId` 详情；
- activity 时序、operation-owned usage totals 与已封存 file-change state。

旧显示位置 handle 与 `show --json` / `--report` 必须拒绝。任一重复 selector 未命中时不得先输出部分结果。

### inspection-query

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Inspection CLI · `niceeval query`](../../../feature/inspection/cli.md#niceeval-query)

`inspection-query.test.ts` 是 machine Inspection Journey owner。它经安装后 `exp` 产生已封口 origin Run，随后以
full carry 发布第二个 target Run，并运行 `alternate` Experiment；历史 Attempt locator 必须继续沿 origin Run 读取事实。
测试再验证 compact discovery 的完整固定 catalog。

测试通过公开 `record snapshot` 形成 setup，以 `query explain --record` 审计 selection 和 fact kinds。

最后，
`query run --record` 返回含 operation identity、behavior version、sealed cutoff、issues、
Evidence、usage 与 Run / Attempt 公开身份的闭合 `niceeval.query/v1` document。
三个入口都以单个 canonical JSON document 交付协议与 behavior version。fixture 显式携带 conversation partial limitation。
完整 usage 仍保留 input/output totals，不被改写为 partial。Snapshot 形成语义仍由 Record E2E 拥有。
本 owner 只把公开 Snapshot 文件当读取输入。

`overview.get` 必须在一次读取中关闭 `main`／`alternate` × `inspection` cell
的 latest logical-slot membership。它同时交付 denominator、missing、
`pass | points | mixed`、四态 Verdict tally、coverage、issues 与 Evidence。

pass-rate 与 points 使用带状态的 MetricValue。状态闭集是
`available | partial | unavailable | empty | unsupported | failed`。
结果保留 selected Run identity、origin/reference relation 与 Attempt locator。

`inspection-multi` 用两个 points Eval 和各两个 Attempt 区分三层 score。
member 是单次 Attempt 真值，cell 是完整 Attempt 的均值，Experiment 是可见 cell 之和。
测试只读 operation 交付的 MetricValue，不在消费面重算通过率、score 或 coverage。

`attempt.get` 必须公开稳定 Assertion entry index。
`attempt.assertion.detail` 按 exact `entryId` 交付完整已封存 entry、sourceSites、
规范化 check/decision diagnostic tree、matcher comparator/source ledger 与 retained target。

tool/event target 的 anchor 与 trace 使用同一 `toolOccurrenceId`／`eventId`。
不存在的 `toolOccurrenceId` ↔ Sandbox `commandId` join 必须明示 unavailable，
不能按位置或文本猜配。

`attempt.trace` 把 current durable `tool-start` / `tool-finish` 投影成有界
`tool-call` / `tool-result` outline。它保留稳定 `itemId` 与 exact
`toolOccurrenceId`，但不暴露 family wire。

`attempt.trace.detail` 用 `toolOccurrenceId` 取得同一 occurrence 的 call/result
以及完整已封存输入与结果。下钻只接受 `itemId`、`toolOccurrenceId` 与 `commandId`。
数组 index、Turn/card 序号、旧 `t<N>.c<M>` 与 `cmd<N>` 都不是公开 selector。

`attempt.sources` 从同一 Attempt 的 Assertions source sites 连接 exact origin Run Sources；target carry Run 不能替换历史源码事实。

### snapshot-browser-journey

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [审阅一次 Run 怎样采用结果](../../../feature/insight/use-case/审阅一次Run怎样采用结果.md)

`view-snapshot.browser.spec.ts` 是 Snapshot browser Journey owner。它验证固定第一方页面从 overview、Run 到 Attempt detail
的连续审阅路径，以及 Attempt 详情中可操作的调试证据。

它执行正式公开 `exp → record snapshot → view --record → ready`，从 lifecycle URL 启动真实 Chromium。
浏览器分别打开 fixed overview、Run 与 exact Attempt，以 semantic heading、table 与可见文案读取 Verdict、denominator、Issues、Evidence、Score 和 coverage。

不允许用一个 raw JSON `<pre>` 冒充人读 View。
overview 还通过公开 Language combobox 在 `Overview` 与 `总览` 之间切换，不读取 CSS 或内部组件。

Attempt 读面同时拥有 scored matcher 的 sealed result、weight / earned、measurement 与 bounded collection 摘要。
它还显示已封存源码与断言位置、按 Turn 组织的 session log、可搜索事件，以及 exact tool occurrence 的输入、输出与完成状态。

工具调用与 Turn 可折叠。执行时序与 usage 保留可见的固定投影，不能用三列 raw value 表格代替这些关系。
Run 读面使用紧凑 score 数字并具名显示 partial coverage。随后在 operational store 发布新 Run 并 reload。
Snapshot overview 仍只看到原 sealed cutoff，且不提供 refresh action。每个 View 最后通过 SIGTERM 受控停止并取得 `closed`。

### operational-revision-refresh

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [制作可访问页面](../../../feature/insight/use-case/制作可访问页面.md)

`view-operational-refresh.browser.spec.ts` 验证 operational View 只在用户确认后原子切换 latest-slot membership。
它打开当前 project 的 fixed overview，立即显示 first Run member 和 Issues / Evidence 语义区。测试然后通过
另一次公开 `exp` 为同一 logical slot 发布 second Run member。refresh 前 first 可见、second 不可见；
用户确认后原子切换，first 被 latest-slot selection 替换、second 可见，页面不混合半份 revision。

### loopback-authorization

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [制作可访问页面](../../../feature/insight/use-case/制作可访问页面.md)

`view-authorization.browser.spec.ts` 是 loopback authorization 单边界 owner。它沿 ready URL 的 fragment credential 完成一次交换，核对 HttpOnly / SameSite=Strict / host-only session，并从 Chromium 已成功的数据 request 取得精确 URL、method 与 body。同一 request 在 exact Host / Origin / session 下成功；缺 session、错 Origin 或错 Host 均拒绝。成功与拒绝响应都是 `no-store`，同一 fragment credential 不能第二次交换。

### view-lifecycle-cleanup

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [制作可访问页面](../../../feature/insight/use-case/制作可访问页面.md)

`view-lifecycle.test.ts` 是 lifecycle cleanup 单边界 owner。它用公开端口冲突制造启动失败，确认没有半份 `ready`，诊断只在 stderr；又分别对 ready 进程发送 SIGINT 和 SIGTERM，确认 stdout 仅含 lifecycle NDJSON 且以唯一 `closed` 终止。进程终结后，旧 session URL 不可达、端口可重绑、公开 `record snapshot` 立即成功，而 Testkit 负责核对该子进程组无残留。

## Last-good refresh E2E 例外

当前公开面没有稳定输入能在已存在 last-good revision 后仅使新 candidate build 失败。破坏 SQLite / Record bytes、调用私有 endpoint 或增加测试 hook 都会把 E2E 锁到实现。因此本轮不创建 last-good 假 owner；当产品提供可签入、可重现的公开失败输入时，再建立单独 owner，验证失败保留 last-good、展示诊断并允许后续 retry。
