# 功能域 · Machine Inspection 与第一方 Web view

`e2e/report/` 验证安装后 candidate 的两条最终公开面。
`niceeval query discover | explain | run` 交付 machine document。`niceeval view` 从当前
project 的 sealed cutoff 或显式 `RecordSnapshot` 启动第一方 loopback Web UI。
测试只从安装后 CLI、HTTP 与真实 Chromium 进入，不读 SQLite table、Record bytes 或源码。

`show`、`insight`、`view --out` 与 static export 已删除，不保留别名。View 不接受自定义 Page、component、theme、route、renderer 或其它 Report 作者面。`view --json` 的 stdout 只是 `niceeval.view-lifecycle/v1` NDJSON；诊断只写 stderr。

## 公开验收边界

- Machine query 保留固定 operation catalog，同一 request 可以从当前 project 或 `--record <snapshot>` 的 sealed facts 执行。
- `view [@locator | --run <id>...] [--record <snapshot>] [--no-open] [--port <port>] [--json]` 只监听 loopback。`ready` 事件的 URL 携带一次性 fragment credential；换取后使用进程期 session。
- Operational view 可发现新封口 Run，用户确认后原子切换 revision。Snapshot view 的 sealed cutoff 固定，不创建 project watcher，不提供 refresh。
- View 的 en / zh-CN catalog 与语言切换由公开 DOM 验收；machine query / CLI 仍只交付英语协议面，不与浏览器 catalog 共用断言。
- Session data 验证 exact Host、Origin 与 session，并带 `Cache-Control: no-store`。测试从浏览器已实际发出的 request 取得精确边界，再次发送该请求。它不在 fixture 中复制 Host 安全算法或猜测私有 endpoint。
- 启动失败、SIGINT 与 SIGTERM 都回收 reader、server、session、watcher 与子进程。受控停止以唯一 `closed` 终止；SIGKILL 不承诺 terminal event。

## 退役边界

Report Repo 只保留固定 Inspection 与 View 需要的 Playwright runner。

## E2E owner anchors

### inspection-query

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [核对数据完整度](../../../feature/reports/use-case/核对数据完整度.md)

`inspection-query.test.ts` 是 machine Inspection Journey owner。它经安装后 `exp` 产生已封口 Run。
随后验证 compact discovery 的完整固定 catalog。

测试通过公开 `record snapshot` 形成 setup，以 `query explain --record` 审计 selection 和 fact kinds。

最后，
`query run --record` 返回含 operation identity、behavior version、sealed cutoff、issues、
Evidence、usage 与 Run / Attempt 公开身份的闭合 `niceeval.query/v1` document。
三个入口都以单个 canonical JSON document 交付协议与 behavior version。fixture 显式携带 conversation partial limitation。
完整 usage 仍保留 input/output totals，不被改写为 partial。Snapshot 形成语义仍由 Record E2E 拥有。
本 owner 只把公开 Snapshot 文件当读取输入。

### snapshot-browser-journey

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [审阅一次 Run 的闭合结果](../../../feature/reports/use-case/审阅一次Run怎样采用结果.md)

`view-snapshot.browser.spec.ts` 是 Snapshot browser Journey owner。

它执行正式公开 `exp → record snapshot → view --record → ready`，从 lifecycle URL 启动真实 Chromium。
浏览器分别打开 fixed overview、Run 与 exact Attempt，以 semantic heading、table 与可见文案读取 Verdict、denominator、Issues、Evidence、Score 和 coverage。

不允许用一个 raw JSON `<pre>` 冒充人读 View。
overview 还通过公开 Language combobox 在 `Overview` 与 `总览` 之间切换，不读取 CSS 或内部组件。

Attempt 读面同时拥有 scored matcher 的 sealed result、weight / earned、measurement 与 bounded collection 摘要。
Run 读面使用紧凑 score 数字并具名显示 partial coverage。随后在 operational store 发布新 Run 并 reload。
Snapshot overview 仍只看到原 sealed cutoff，且不提供 refresh action。每个 View 最后通过 SIGTERM 受控停止并取得 `closed`。

### operational-revision-refresh

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [在 View 中审阅封口结果](../../../feature/reports/use-case/制作可访问页面.md)

`view-operational-refresh.browser.spec.ts` 是 operational revision Journey owner。它打开当前
project 的 fixed overview，立即显示已封口 Run 和 Issues / Evidence 语义区。测试然后通过
另一次公开 `exp` 发布新封口 Run。View 必须先提示 update 且不显示新 Run；用户确认
refresh 后再原子切换，页面同时保留旧 Run 与新 Run 的完整身份，不混合半份 revision。

### loopback-authorization

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [在 View 中审阅封口结果](../../../feature/reports/use-case/制作可访问页面.md)

`view-authorization.browser.spec.ts` 是 loopback authorization 单边界 owner。它沿 ready URL 的 fragment credential 完成一次交换，核对 HttpOnly / SameSite=Strict / host-only session，并从 Chromium 已成功的数据 request 取得精确 URL、method 与 body。同一 request 在 exact Host / Origin / session 下成功；缺 session、错 Origin 或错 Host 均拒绝。成功与拒绝响应都是 `no-store`，同一 fragment credential 不能第二次交换。

### view-lifecycle-cleanup

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [在 View 中审阅封口结果](../../../feature/reports/use-case/制作可访问页面.md)

`view-lifecycle.test.ts` 是 lifecycle cleanup 单边界 owner。它用公开端口冲突制造启动失败，确认没有半份 `ready`，诊断只在 stderr；又分别对 ready 进程发送 SIGINT 和 SIGTERM，确认 stdout 仅含 lifecycle NDJSON 且以唯一 `closed` 终止。进程终结后，旧 session URL 不可达、端口可重绑、公开 `record snapshot` 立即成功，而 Testkit 负责核对该子进程组无残留。

## Last-good refresh E2E 例外

当前公开面没有稳定输入能在已存在 last-good revision 后仅使新 candidate build 失败。破坏 SQLite / Record bytes、调用私有 endpoint 或增加测试 hook 都会把 E2E 锁到实现。因此本轮不创建 last-good 假 owner；当产品提供可签入、可重现的公开失败输入时，再建立单独 owner，验证失败保留 last-good、展示诊断并允许后续 retry。
