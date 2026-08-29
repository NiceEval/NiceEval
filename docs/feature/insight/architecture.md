# Insight 架构

## 固定读取链

Insight 只读取 Run 已发布事实。轻量 loopback Host 提供 SPA assets、本机 session 与只读数据 transport；sqlite-wasm
Worker 独占浏览器 SQLite connection 和 statement lifecycle，并在开始读取时固定一个 `PublicationCutoff`。

```text
Run publication store
  → session-protected read transport
  → sqlite-wasm Worker / facts adapter at PublicationCutoff
  → selectInspectionOperation(facts, operation)
  → React
```

Host 不返回业务 DTO，也不按 route 计算指标、比较或调试详情。读取资源不接受 SQL、formula、任意 operation 或分页
参数；每项请求都校验 session、Host 与 Origin，listener 只绑定 `127.0.0.1`。credential 不进入 Run facts、页面数据或
lifecycle event。

## repository 与固定 operation

Inspection 拥有 query definition 和 result builder。Browser adapter 只把固定 cutoff 的 facts 交给 selector；React
读取组件只调用与固定 Inspection operation 对应的具名 query hook。route loader 只用同一 query definition 为当前
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

`ViewRuntime` 独占 repository、Worker 与 generation lifecycle。React shell 不创建或替换这些资源，只通过具名 refresh
command 请求切换。repository 在一个 cutoff 内保持稳定；发现更高 publication revision 时只提示更新。

用户确认 refresh 后，`ViewRuntime` 创建候选 generation 并固定新的 `PublicationCutoff`。候选预取当前可见 surface；
overlay 打开时，该 surface 同时包含 overlay 与其 background location。预取前固定 location epoch，全部成功后复核 epoch，
只有仍对应同一可见 surface 时才一次 publish。准备失败或 epoch 已变化时继续服务 last-good generation，不暴露半成品，
也不混合两个 cutoff。continuation 无法在原 cutoff 继续时显示 restart-required。

新 generation publish 后，旧 generation 不再受理读取。`ViewRuntime` 等待它已经开始的真实 I/O drain，再关闭 repository、
Worker 与 connection。React Root Error Boundary 把启动错误局部化为可恢复页面；Worker 错误跨边界时携带稳定 typed code，
不依赖异常文本分类。

SIGINT、SIGTERM 或页面关闭时，Host 停止 listener、失效 session并释放 transport；Worker 关闭 connection。物理数据库、
migration 与持久事实回收属于 Run 持久 adapter，不形成 Insight 用户流程；浏览器 generation 的收尾仍由 `ViewRuntime` 拥有。

PR Preview 只加载仓库控制的合成 Run facts与同一候选 SPA assets，不接收真实项目数据、路径、credential 或 loopback
session。未来写入能力使用另行定义的本机授权 API，不复用只读 transport 或 Worker query port。
