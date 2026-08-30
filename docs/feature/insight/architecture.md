# Insight 架构

## 固定读取链

Insight 只读取 Run 已发布事实。薄 Host 提供 SPA assets 与 typed Inspection transport，并独占 SQLite connection、
statement 与 generation lifecycle。浏览器不下载或打开 Record；它只持有 opaque generation identity，并在一次读取开始时
固定该 generation 的 `PublicationCutoff`。

```text
Run publication store
  → generation-owned pinned Record reader at PublicationCutoff
  → selectInspectionOperation(facts, operation)
  → typed HTTP transport
  → TanStack Query → React
```

Host 不建立业务 DTO，也不按 route 另算指标、比较或调试详情；响应直接使用 Inspection 的正式 result schema。endpoint
只接受严格解码的固定 Inspection operation，不接受 SQL、formula、文件路径或任意分页参数，并限制 body、响应与执行时长。
本机 Host 的每项请求继续校验 session、Host 与 Origin，listener 只绑定 `127.0.0.1`。credential 不进入 Run facts、
页面数据或 lifecycle event。部署 Host 只从同一 immutable deploy 内的构建常量定位 private Record。

## repository 与固定 operation

Inspection 拥有 query definition 和 result builder。Host adapter 只把 generation-bound facts 交给 selector；HTTP
adapter 只传输正式 request/result document。React 读取组件只调用与固定 Inspection operation 对应的具名 query hook。route loader 只用同一 query definition 为当前
generation 准备结果，不建立另一套读取语义。组件、route loader 与语言 catalog 不得嵌入 SQL、拼业务查询、重选成员，
也不得重算 denominator、score、coverage 与 usage。

Run discovery 唯一调用 `run.list`；Run debugger 唯一调用 `run.get`。
`run.get` 在同一 cutoff 一次交付 state、时间、expected/published/missing、slot binding 与 Attempt locator。
它也交付 active pending、terminal absence、coverage、各指标分母、issues 与 limitations。
exact Run 存在但尚有空 slot 时仍成功，不把 missing 变成失败或零。

Results 调用内部 `overview.get`；Experiment detail 调用 `experiment.get`。
Attempt route 先调用 `attempt.get` 与 `attempt.trace` outline，展开时以稳定 identity 调用 `attempt.trace.detail`。
数组 index、显示次序和折叠位置都不是查询 identity。

## SPA、刷新与收尾

Insight 是 React 19 + React Router + Tailwind 4 + Vite SPA。根路由按 repository 的稳定 Experiment 顺序选择默认项；
selector 写入 URL，语言独立保存。Run/Attempt 软导航保留 background location，深链接与硬加载复用同一详情内容。

浏览器 `ViewRuntime` 独占 QueryClient、候选 identity、location epoch 与 last-good publish；Host 独占 pinned reader、
lease、drain 与 connection lifecycle。React shell 不创建或替换 Host 资源，只通过具名 refresh command 请求候选。
repository 在一个 cutoff 内保持稳定；发现更高 publication revision 时只提示更新。

用户确认 refresh 后，Host 创建候选 generation 并返回 opaque identity 与固定的 `PublicationCutoff`。浏览器以该 identity
预取当前可见 surface；
overlay 打开时，该 surface 同时包含 overlay 与其 background location。预取前固定 location epoch，全部成功后复核 epoch，
只有仍对应同一可见 surface 时才一次 publish。准备失败或 epoch 已变化时继续服务 last-good generation，不暴露半成品，
也不混合两个 cutoff。continuation 无法在原 cutoff 继续时显示 restart-required。

新 generation publish 后，Host 退休旧 generation；已经开始的真实 I/O 与 lease drain 后才关闭 reader 与 connection。
未知、已退休或 cutoff 不匹配的 identity 返回 typed restart-required，绝不读取 latest 作为 fallback。React Root Error Boundary
把启动错误局部化为可恢复页面；HTTP 错误携带稳定 typed code，不依赖异常文本分类，也不泄露路径、SQL、stack 或部署目录。

SIGINT、SIGTERM 或页面关闭时，本机 Host 停止 listener、失效 session，并等待请求 drain 后关闭 generation readers。物理数据库、
migration 与持久事实回收属于 Run 持久 adapter，不形成 Insight 用户流程。

PR Preview 的 SPA、唯一获准的 Function 与 Function-private canonical Record 必须属于同一 immutable deploy，并由同一
receipt 绑定 candidate commit、Function runtime 与 Record digest。静态站不得下载 Record。Preview 只加载仓库控制的合成
Run facts，不接收真实项目数据、路径、credential 或 loopback session。未来写入能力使用另行定义的本机授权 API，不复用
只读 Inspection endpoint。
