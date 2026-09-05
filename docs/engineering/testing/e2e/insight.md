# 功能域 · Insight

`e2e/insight/` 验证安装后 candidate 的 `niceeval view` 第一方 loopback Insight SPA。它独立安装 Playwright 并声明 Chromium，只从安装后 CLI、HTTP 与真实 Chromium 进入，不读 SQLite table、Record bytes 或源码。

`view [--run <id>...] [--no-open] [--port <port>]` 只监听 loopback。exact Attempt 从页面内的 Run/Attempt 导航进入；locator 保留为数据 identity。stdout 中的 ready URL 携带一次性 fragment credential；换取后使用进程期 session。诊断只写 stderr。

## 公开验收边界

- Operational Insight 可发现新发布 Run，用户确认后原子切换完整 PublicationCutoff；每次读取与 continuation token 都绑定同一 cutoff。
- View 的 en / zh-CN catalog 与语言切换由公开 DOM 验收，不读取 CSS 或内部组件。
- Session data 验证 exact Host、Origin 与 session，并带 `Cache-Control: no-store`。测试从浏览器已实际发出的 request 取得精确边界，再次发送该请求，不在 fixture 中复制 Host 安全算法或猜测私有 endpoint。
- 启动失败、SIGINT 与 SIGTERM 都回收 reader、server、session、watcher 与子进程。终态由退出码、stderr、端口释放和旧 session 失效共同验收。
- View 不接受自定义 Page、component、theme、route、renderer 或其它历史 Report 作者面。

## E2E owner anchors

### operational-browser-journey

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [审阅一次 Run 怎样采用结果](../../../feature/insight/use-case/审阅一次Run怎样采用结果.md)

`view-snapshot.browser.spec.ts` 的文件名保留历史测试域标识。它是 operational browser Journey owner，验证固定第一方页面从 overview、Run 到 Attempt detail 的连续审阅路径，以及 Attempt 详情中可操作的调试证据。

它执行正式公开 `exp → view`，从 stdout 的 ready URL 启动真实 Chromium。浏览器分别打开 fixed overview、Run 与 exact Attempt，以 semantic heading、table 与可见文案读取 Verdict、denominator、Issues、Evidence、Score 和 coverage。

不允许用一个 raw JSON `<pre>` 冒充人读 View。overview 还通过公开 Language combobox 在 `Overview` 与 `总览` 之间切换。

Attempt 读面显示 scored matcher 的 sealed result、weight / earned、measurement 与 bounded collection 摘要。它还显示已封存源码与断言位置、按 Turn 组织的 session log、可搜索事件，以及 exact tool occurrence 的输入、输出与完成状态。

工具调用与 Turn 可折叠。执行时序与 usage 保留可见的固定投影，不能用三列 raw value 表格代替这些关系。Run 读面使用紧凑 score 数字并具名显示 partial coverage。

随后在 operational store 发布新 Run 并 reload。refresh 前 overview 仍只看到原 PublicationCutoff。每个 View 最后通过 SIGTERM 受控停止，并验证进程与 listener 已结束。

### operational-revision-refresh

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [制作可访问页面](../../../feature/insight/use-case/制作可访问页面.md)

`view-operational-refresh.browser.spec.ts` 验证 operational View 只在用户确认后原子切换 latest-slot membership。它打开当前 project 的 fixed overview，立即显示 first Run member 和 Issues / Evidence 语义区。测试然后通过另一次公开 `exp` 为同一 logical slot 发布 second Run member。refresh 前 first 可见、second 不可见；用户确认后原子切换，first 被 latest-slot selection 替换、second 可见，页面不混合半份 revision。

该 Journey 在真实 Host 接受提交后延迟交付原始响应，触发浏览器 Back，验证选择与页面地址暂时保留；响应交付后自动进入历史目标并显示新 Attempt，Forward 仍能返回。另在准备数据时延迟真实响应，验证 selector 可继续导航，废弃候选后 last-good 仍可读，随后手动刷新可取得新结果。拦截器只控制 HTTP 时序，释放时等待处理完成，不复制产品响应或读取浏览器内部状态。

无新结果时再次 Refresh 保留展开的 hierarchy。Host 已真实提交、提交响应与当前 generation 读回均丢失时，页面只提供 Reload，旧结果交互不可继续；恢复 HTTP 后，通过该按钮硬加载可读取最新 Attempt。

### loopback-authorization

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [制作可访问页面](../../../feature/insight/use-case/制作可访问页面.md)

`view-authorization.browser.spec.ts` 是 loopback authorization 单边界 owner。它沿 ready URL 的 fragment credential 完成一次交换，核对 HttpOnly / SameSite=Strict / host-only session，并从 Chromium 已成功的数据 request 取得精确 URL、method 与 body。同一 request 在 exact Host / Origin / session 下成功；缺 session、错 Origin 或错 Host 均拒绝。成功与拒绝响应都是 `no-store`，同一 fragment credential 不能第二次交换。

### view-lifecycle-cleanup

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [制作可访问页面](../../../feature/insight/use-case/制作可访问页面.md)

`view-lifecycle.test.ts` 是 lifecycle cleanup 单边界 owner。它用公开端口冲突制造启动失败，确认没有输出可访问 URL，诊断只在 stderr；又分别对 ready 进程发送 SIGINT 和 SIGTERM。进程终结后，旧 session URL 不可达、端口可重绑，后续 `run list` 读取正常，而 Testkit 负责核对该子进程组无残留。

## Last-good refresh E2E 例外

当前公开面没有稳定输入能在已存在 last-good revision 后仅使新 candidate build 失败。破坏 SQLite / Record bytes、调用私有 endpoint 或增加测试 hook 都会把 E2E 锁到实现。因此本轮不创建 last-good 假 owner；当产品提供可签入、可重现的公开失败输入时，再建立单独 owner，验证失败保留 last-good、展示诊断并允许后续 retry。
