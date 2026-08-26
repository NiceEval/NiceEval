---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Insight

Insight 是本机开发者用来审阅已封口 Record 的 debugger。`niceeval view` 启动一个正常的
React 19、React Router、Tailwind 4 与 Vite SPA，让浏览器直接读取一份一致的完整 RecordSnapshot。

```text
live Record SQLite
  → Record Host 形成一致的完整 RecordSnapshot
  → 受 session 保护的 loopback GET SQLite
  → sqlite-wasm Worker
  → 集中 typed query/repository
  → React
```

Snapshot 只解决 SQLite WAL 与跨进程读取的一致性。它不是 Insight 的第二套 schema、JSON DTO、
汇总缓存或脱敏格式；浏览器读取的是 Snapshot 内完整的已封口 Record 事实。

Insight 不是可定制的 Report、component 或 service 作者面。它不提供持久 JSON DTO、业务 REST API、
任意 SQL、任意 route，或用户自带的呈现实现。

## 固定的审阅体验

`niceeval view` 打开带 NiceEval Header 的 Overview。Header 右上角始终先显示 `Experiments`
selector，再显示 `Language`。根路由按稳定顺序选择默认 Experiment；selector、语言与深链接能同时成立。

Overview 保留 Summary cards、指标、Experiment 比较和 Experiment → Eval → Run → Attempt 层级 table。
读者从 table 进入 Run 或 Attempt debugger。比较、指标和 table 都由同一个 typed repository 从 Snapshot 读取，
组件不会散写 SQL。

软导航把详情显示为 Overview 上的 drawer 或 modal，关闭详情或使用 Back 会回到原选择。复制的 Run 或
Attempt URL 在硬加载时显示完整详情，Forward 也恢复对应详情。

Run 与 Attempt debugger 连续呈现身份、判定、指标、source、assertions、trajectory、tool input/output、
timeline、usage、commands、diagnostics 与 diff。`partial`、`not-recorded` 与 `truncated` 始终是可见事实。

浏览器保留中英语言切换。语言只改变界面文案，不改变 Snapshot、Experiment identity、URL 或读取结果。

## 本机读取、刷新与 Preview

真实用户的完整 SQLite 只交给本机 `127.0.0.1` 的已授权 session 浏览器。轻量 loopback Host 只拥有 Snapshot、
Vite assets、session、refresh 与进程生命周期；它不提供业务数据 API。浏览器从受保护的 GET 取得 SQLite，
由 sqlite-wasm Worker 打开并交给集中 repository。

没有 `--record` 时，Host 可以发现新的 sealed publication。页面先提示更新，用户确认后才形成下一份完整
Snapshot 并原子切换；失败时 last-good Snapshot 继续可读。`--record` 的 Snapshot 没有 watcher，也不会刷新。

主仓 PR Preview 只使用同一候选 SPA 和仓库控制的合成 `record.sqlite` RecordSnapshot。它不接收真实用户
Record、项目路径、loopback session 或 secret。Preview 是第一方 UI 的固定 dogfood，不是用户分享面。

未来 Playground 的写入会经由独立的本地授权 API。当前只读 Snapshot 不是写协议，Insight 不预设该 API 的
endpoint、payload 或 mutation 形状。

- [CLI](cli.md)：`niceeval view` 的唯一命令面。
- [Architecture](architecture.md)：Snapshot、loopback、Worker、repository、刷新与信任边界。
- [Use cases](use-case/README.md)：打开 Overview 与连续审阅 Run、Attempt 的用户路径。
