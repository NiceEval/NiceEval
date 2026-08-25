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
- Session data 验证 exact Host、Origin 与 session，并带 `Cache-Control: no-store`。测试从浏览器已实际发出的 request 取得精确边界，再次发送该请求。它不在 fixture 中复制 Host 安全算法或猜测私有 endpoint。
- 启动失败、SIGINT 与 SIGTERM 都回收 reader、server、session、watcher 与子进程。受控停止以唯一 `closed` 终止；SIGKILL 不承诺 terminal event。

## 退役边界

以下 owners 已删除：

- `inspection-show`、`report-project-current`、`report-config-reload`；
- `report-execution-evidence`、`report-static-export`、`report-show-json`；
- `report-source-snapshot` 与旧 `report-browser-journey`。

对应的 reports、themes、作者 DSL、React 用户依赖与 static server 不迁移。
Report Repo 只保留固定 View 需要的 Playwright runner。

## E2E owner anchors

### inspection-query

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [核对数据完整度](../../../feature/reports/use-case/核对数据完整度.md)

`inspection-query.test.ts` 是 machine Inspection Journey owner。它经安装后 `exp` 产生已封口
Run，再验证 compact discovery 的完整固定 catalog。

测试通过公开 `record snapshot`
形成 setup，以 `query explain --record` 审计 selection 和 fact kinds。最后，
`query run --record` 返回含 operation identity、behavior version、sealed cutoff、issues、
Evidence、usage 与 Run / Attempt 公开身份的闭合 `niceeval.query/v1` document。
conversation limitation 不会把完整 usage 改写为 partial。Snapshot export 语义仍由
Record E2E 拥有，本 owner 只把公开 Snapshot 文件当读取输入。

### snapshot-browser-journey

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [审阅一次 Run 的闭合结果](../../../feature/reports/use-case/审阅一次Run怎样采用结果.md)

`view-snapshot.browser.spec.ts` 是 Snapshot browser Journey owner。它执行正式公开 `exp → record snapshot → view --record --run → ready`，从 lifecycle URL 启动真实 Chromium，读取精选 Run、exact Attempt locator 与 verdict。随后在 operational store 发布新 Run 并 reload，仍只看到 Snapshot 的 sealed cutoff，因而以公开观察证明 Snapshot 模式没有 watcher / refresh。最后通过 SIGTERM 受控停止并取得 `closed`。

### operational-revision-refresh

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [在 Web view 中交互排障](../../../feature/reports/use-case/制作可访问页面.md)

`view-operational-refresh.browser.spec.ts` 是 operational revision Journey owner。它打开当前
project 时必须直接进入一个已选 Run，不能落入“未选中”索引。测试然后通过
另一次公开 `exp` 发布新封口 Run。View 必须公开提示 update；用户确认
refresh 后原子切换，页面同时保留旧 Run 与新 Run 的完整身份，不混合半份 revision。

### loopback-authorization

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [在 Web view 中交互排障](../../../feature/reports/use-case/制作可访问页面.md)

`view-authorization.browser.spec.ts` 是 loopback authorization 单边界 owner。它沿 ready URL 的 fragment credential 完成一次交换，核对 HttpOnly / SameSite=Strict / host-only session，并从 Chromium 已成功的数据 request 取得精确 URL、method 与 body。同一 request 在 exact Host / Origin / session 下成功；缺 session、错 Origin 或错 Host 均拒绝。成功与拒绝响应都是 `no-store`，同一 fragment credential 不能第二次交换。

### view-lifecycle-cleanup

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [在 Web view 中交互排障](../../../feature/reports/use-case/制作可访问页面.md)

`view-lifecycle.test.ts` 是 lifecycle cleanup 单边界 owner。它用公开端口冲突制造启动失败，确认没有半份 `ready`，诊断只在 stderr；又分别对 ready 进程发送 SIGINT 和 SIGTERM，确认 stdout 仅含 lifecycle NDJSON 且以唯一 `closed` 终止。进程终结后，旧 session URL 不可达、端口可重绑、公开 `record snapshot` 立即成功，而 Testkit 负责核对该子进程组无残留。

## Last-good refresh E2E 例外

当前公开面没有稳定输入能在已存在 last-good revision 后仅使新 candidate build 失败。破坏 SQLite / Record bytes、调用私有 endpoint 或增加测试 hook 都会把 E2E 锁到实现。因此本轮不创建 last-good 假 owner；当产品提供可签入、可重现的公开失败输入时，再建立单独 owner，验证失败保留 last-good、展示诊断并允许后续 retry。
