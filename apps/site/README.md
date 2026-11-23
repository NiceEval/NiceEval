# 产品站开发入口

`apps/site/` 是 NiceEval Landing Page。修改页面前先按当前项目依赖理解框架，不使用训练记忆中的 Next.js 约定替代本仓库版本。

当前 Next.js 版本的必读规则由 [`AGENTS.md`](AGENTS.md) 拥有；它是 `next dev` 管理的入口，不在本页复制。

## 视觉

站点以排版和留白建立层级，以位置和明度建立区分，颜色只在有语义时出现。落到站点是四条硬约束：

- **只有暗色。** `app/globals.css` 的 `:root` 是唯一色板。站点不装主题机制，也不做浅色切换，所以令牌写死值、不写 `light-dark()`。
- **零圆角、无渐变、无阴影、无发光。** 盒子只加 1px 边，层次靠 `--panel` / `--panel-2` 两级面色。
- **颜色只表判定。** `--good` 是通过、`--bad` 是失败、`--warn` 是等待；`--accent` 只用来区分身份（例如助手回复），不表示好坏。装饰位一律用 `--soft` / `--muted` 加字重，不借语义色。
- **改色只有一条动线。** 只改 `:root` 的站点色板，并让站点局部样式继续使用这些令牌。

Tailwind 只提供 utility，供 `components/magicui/` 下从 [Magic UI](https://magicui.design) 复制粘贴来的组件用；`globals.css` 只 `@import` theme 与 utilities 两层，不引 preflight——preflight 会重置博客正文的列表符号与标题字重。站点自己的版式仍然全部写在 `globals.css` 的语义 class 里。

## 验证

`/INIT.md` 由 `app/INIT.md/route.ts` 在构建时读取`stable/INIT.md` 并生成静态
Markdown 响应。稳定副本是唯一内容来源；部署不依赖跨目录的 `public` 符号链接。
修改该入口后，启动构建产物并通过 HTTP 检查状态、`Content-Type` 与稳定副本内容一致。

```sh
pnpm run site:build
```

本地开发使用：

```sh
pnpm run site:dev
```

入口会在 `5174` 被其它进程占用时尝试后续端口。同一 checkout 不能同时启动两个开发实例；第二个实例会由 Next.js 基于 `.next/dev` 的 owner lock 明确拒绝，不会删除首个实例的输出。

## 异常监控

产品站使用 Sentry Project `niceeval-landing`，组件为 `site`。自营公开 DSN 固定在源码，
仅正式运行环境初始化，Vercel preview/development 保持关闭，不增加 enable 变量。
CLI、eval 和模型运行时不在此接入范围。SDK 与 Node profiler 固定同版 `11.12.0`。

根 trace 采样率为 `0.1`，保留合法父采样。Browser 显式设置 `parentSpanIsAlwaysRootSpan: false`，
确保 `pageload` 下 `site.docs.open` / `site.install_guide.copy` 的子级 `http.client` span 保留操作父级。
浏览器自动 pageload/navigation 分别使用 `site.page.load`、`site.navigation`；
真实文档点击与复制 handler 使用 `site.docs.open`、`site.install_guide.copy`，
复制覆盖 clipboard promise，保留成功、失败、取消 outcome。
文档点击仅表示本地点击处理，不声明外站加载完成。没有下载操作时不制造 download span。
`http.server` 与 `http.client` 仅按有限静态站点路由映射 `site.page.load` / `site.docs.open`，
不传原始 URL 或 query，未知路径回退固定 `http.server` / `http.client`。
错误 `contexts.trace.op` 按既有有限 op 集合与当前活动 span 保留，不硬编码 `http.server`；
Next.js OTel 保持启用，无可安全辨识名的自动 `function` span 保持通用 `function` 以保留完整父子链。
产品站没有业务跨服务 API：所有运行时传播 targets 为空，Browser `traceXHR: false`，
既有外部 tracker、文档跳转、下载/CDN 与同源 RSC 不增加 trace header；空集合不安装 fetch guard。
生产有效页面与 `.rsc` 均为构建期预渲染静态响应，无请求期 SSR/DB 执行及 HTML trace metadata 续接，
不为此改变 Next.js 重定向语义或制造后端。

浏览器业务操作使用独立 inactive span，仅在同步调用边界激活 scope；回调 `await` 后的请求用 `context.run` 显式归属，避免同页交错操作互借父级。Node 保留原异步 provider。`check-sentry-browser.mjs --verify` 包含真实 pageload 下两个操作反序完成、逐级 parent ID 与四次独立指标计数验收。

Browser 使用 trace lifecycle profiling，session rate 为 `0.1`，仅支持实际提供 Profiler
能力的 Chromium。Node 主线程使用 trace lifecycle、session rate `1`，由采样 trace
控制运行窗口；Edge 保持 trace-only。Node-only 动态加载失败仅关闭 profiler，并输出
固定本地诊断，error/tracing 保持初始化。实际 HTML 响应带 `Document-Policy: js-profiling`。
浏览器首次生产开启前必须完成项目 IP scrub 与接收数据核验；本地 transport 通过不代替此门槛。

Node、Edge 和 Browser 的错误事件保留真实异常类型、消息、因果链、堆栈和源码映射标识。
服务端请求错误带上路由模板 `route`、`http.method` 和 `http.status_code`，保留原有事务与业务操作名。
状态取自可用的请求上下文或异常。Next.js 未处理请求异常缺少状态时记为 500。4xx 和请求中止不上报为错误。
请求路径、普通查询参数和错误业务详情可以发送。请求头、查询参数、额外字段和字符串中的凭据替换成
`[Filtered]`。SDK 的默认个人信息采集保持关闭，请求体和响应体不采集。

最终 transport 再过滤 error 中的凭据，并独立重建 span v2、`profile_chunk` v2、固定 log/trace_metric、匿名
Browser session 和 client_report；拒绝 Replay、Cron/check_in、sessions 聚合、legacy profile
及未知 item。profile 只保留合法索引、样本时间、
线程与关联标识；frame 等长清理，不移动索引，不复制动态函数名、业务路径或任意 metadata。
span 保留 SDK 真实 profiler ID、主线程 ID 和时间区间，不给 chunk 伪造单个 trace ID。

构建从实际 `.next/static` 与 `.next/server` JavaScript 解析 AST Identifier 清单，
不采集字符串字面值或源码。浏览器清单路径为
`/_next/static/sentry-profile-assets/<Git SHA>.json`，文件在
`.next/static/sentry-profile-assets/<Git SHA>.json`。完整 release SHA 使不同发布使用不同 URL，
不让 Next 静态资源的 immutable 缓存复用旧清单；运行时仍严格校验清单 release。
本地无正式 release 的构建仅写 `local.json`，浏览器不请求该清单。

`compiler.runAfterProductionCompile` 在 provider 收集资产前生成清单；不能在整个
`next build` 退出后才追加文件。Node 清单继续留在 `.next/server/sentry-profile-assets.json`，
同一 hook 补入编译时已产生的 NFT，进入 provider 的私有 function 文件映射。
文件精确命中且函数属于该文件符号集合才保留；缺失、未到达或 release 不匹配时未知
frame 原位 redact，不推迟 error/tracing 初始化。

发布与清单均使用 `site@<Git SHA>`，Vercel 从 `VERCEL_GIT_COMMIT_SHA` 生成。
正式构建缺少 `SENTRY_AUTH_TOKEN` 失败；上传组织固定 `instaai`，token 只存在于构建环境。
上传后移除公开 sourcemap，官方 CI 缺失或无效 release/manifest/native binding 阻止发布。
本地无 token 不上传。构建、上传、部署同份产物以及生产接收/关联分别验收。

Node native gate 检查最终 NFT 包含 binding 与清单，再将 NFT 文件复制到临时隔离快照加载
binding 并取得真实样本，随后使用真实 SDK 生成 trace lifecycle chunk。构建平台结果不能替代
部署目标的 Node major/ABI、架构与 libc 检查。主线程以外不声明 CPU profiling 支持。

本地隔离验收（不向生产发送）：

```sh
pnpm --filter @niceeval/site exec tsx scripts/check-sentry.ts
pnpm --filter @niceeval/site exec tsc6 --noEmit --incremental false
SENTRY_RELEASE=site@<Git SHA> pnpm --filter @niceeval/site run build
pnpm --filter @niceeval/site exec tsx scripts/check-sentry-profile.ts
```

`check-sentry-native.mjs` 是构建 gate，`--runtime-only` 仅做当前运行时 native/真实 chunk
检查，不能代替最终产物 gate。Browser 原有 `check-sentry-browser.mjs` 保留 error/trace
检查，支持 `--verify` 运行无头 Chromium 端到端校验；`check-sentry-browser-profile.mjs <local Next origin>` 在本地代理真实构建页面，阻断
第三方 tracker，注入真实 SDK 与隔离 transport，并用官方构建工具注入测试 artifact debug ID。
验收先从真实 Next 静态入口读取清单并比对最终构建文件，随后才允许代理补入测试 artifact。
本地 `next start` 不能证明 Vercel 已收集文件。provider 验收使用实际 Vercel adapter 的
`NEXT_ADAPTER_PATH` 构建后，运行 `node scripts/check-sentry-profile-provider.mjs`：检查
`.next/output` Build Output API v3 中的 release 唯一路径、清单与公开 JS 的 AST 一致，
并核对 Node function `filePathMap` 的私有清单引用。此 gate 不部署、不代替部署后的 HTTP 验收。
仅 clipboard 外部边界替换，不修改真实页面 handler。测试用 session rate `1` 只用于隔离验收。
`?mode=unsampled` 验证 session 不采样，缺 Profiler 时维持 error/tracing。
浏览器最后 chunk 异步到达，等待实际 transport；不调用 manual stop 或私有 profiler。
源码映射、frames/stacks 索引、真实复制 span、外部 receiver 302/307 与 XHR 无 header 均分别检查。

### 日志、指标与匿名健康

固定业务 wrapper 的顶层 `site.docs.open` / `site.install_guide.copy` 每次结束记录
`app.operation.count=1` 与 `app.operation.duration` distribution（millisecond），包括
success/error/cancelled，子阶段不重复计数。指标独立于 trace 采样。自动 pageload/navigation
span 仍表示页面性能，不从采样 span 推算全量操作数；产品站没有 scheduler，不造 tick 或 Cron。

仅允许固定日志 `operation.failed`（error）、`operation.degraded`（warn）、
`service.started` / `service.stopped`（info）。业务错误在 wrapper 捕获位置记录，取消不记成
服务故障。Node 初始化记录真实启动与 native 不可用降级；没有真实 shutdown owner 时不制造
stopped 日志。原有 console/analytics/logger 不自动转发，不收任意参数或异常正文。

beforeSendLog / beforeSendMetric 先清理，最终 transport 在 SDK 合并 scope 后再按 typed
attributes 重建。log/trace_metric 均保留 v2 数字 version、官方 content_type、实际 item_count，
Browser infer_ip/infer_user_agent 为 never。过滤同步完成，不创建第二个待 flush 队列；委托
底层有界 flush，发送失败不替换业务结果，不递归报告自身发送错误。

Browser 显式使用 page lifecycle 的 browserSessionIntegration，不调用 setUser、不跨 tab
持久化身份。保留 SDK 随机 sid、init、ISO 时间和累计 errors/status，仅保留安全
release/environment；删除 did、IP、UA 与未知属性。仅承诺 session 健康率，不承诺用户去重。
Node/Edge 不制造浏览器健康会话。client_report 仅接受本版 SDK 的有限 reason/category
与正整数 quantity，支持客户端过滤/限流/队列损耗观察。生产持久数据及统计另行验收。

小型真实 SDK 验收不下载依赖、不构建或访问生产：

```sh
pnpm --filter @niceeval/site exec tsx scripts/check-sentry-quality.ts
pnpm --filter @niceeval/site exec node scripts/check-sentry-browser-quality.mjs
```

前者使用 SDK Node transport 向 loopback HTTP receiver 发送真实序列化 wire；后者启动
独立浏览器 fixture，检查健康页、handled/unhandled error、同 sid 更新与真实 Browser fetch
transport。真实浏览器隐藏页面触发 SDK client_report，不调用私有发送器。`?off` 不初始化
客户端。测试替换 ingestion 边界，不把本地 fixture 注册为产品路由。
