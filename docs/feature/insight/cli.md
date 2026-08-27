# Insight CLI

## `niceeval view`

```sh
niceeval view [--run <run-id>...] \
  [--record <RecordSnapshot>] [--no-open] [--port <port>] [--json]
```

`niceeval view` 是 Insight 的唯一命令面。它准备常规 React SPA、当前一致的完整 RecordSnapshot 与受保护的
loopback session，然后打开本机浏览器。页面在 sqlite-wasm Worker 中直接读取 Snapshot；命令不生成业务
JSON 或 View DTO。

| 参数 | 行为 |
| --- | --- |
| `--run <run-id>` | 在同一 Overview 中选择一个或多个 Run；Run 与 Attempt 详情仍由页面和 URL 定位。 |
| `--record <RecordSnapshot>` | 选择一个已验证的完整 Snapshot 输入；它固定 exact Seal，不 watch 也不 refresh。 |
| `--no-open` | 准备受保护的 loopback View，但不请求 OS 打开浏览器。 |
| `--port <port>` | 选择 `127.0.0.1` listener 的端口。 |
| `--json` | 只向 stdout 写 `niceeval.view-lifecycle/v1` NDJSON lifecycle events。 |

没有 `--record` 时，CLI 让 Record Host 从 operational Store 形成当前 Snapshot。它只在完整 SPA assets、
session 和 SQLite GET 都可用后产生 `ready`。新 sealed publication 只显示更新可用，必须由浏览器用户确认
才刷新；`closed` 与 `failed` 结束本次 lifecycle。

`--json` 的 `ready` 可以给出受保护的本机入口 URL。调用方必须将它视为 session material，不得上传原始
stdout。`closed`、`failed` 与所有 lifecycle event 不含 Snapshot bytes、Record facts、cookie 或可复用 credential。

此命令没有 `--out`、部署、分享、Report、Page、component、theme、renderer、route、operation 或 SQL 参数。
PR Preview 由主仓使用合成 fixture Snapshot dogfood，而不是 `niceeval view` 可选的 target。
