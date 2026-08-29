# Insight CLI

## `niceeval view`

```sh
niceeval view [--run <run-id>...] [--no-open] [--port <port>] [--json]
```

`niceeval view` 是 Insight 的唯一命令面。它准备 SPA、本机授权 session 与 Run facts 的只读 transport，然后打开浏览器。
页面在 sqlite-wasm Worker 中固定 `PublicationCutoff` 并直接执行 Inspection operation；命令不生成业务 JSON 或 View DTO。

| 参数 | 行为 |
| --- | --- |
| `--run <run-id>` | 预选一个或多个 exact Run；详情继续由页面 URL 定位。 |
| `--no-open` | 准备受保护的 loopback View，但不请求 OS 打开浏览器。 |
| `--port <port>` | 选择 `127.0.0.1` listener 的端口。 |
| `--json` | 只向 stdout 写 `niceeval.view-lifecycle/v1` NDJSON lifecycle events。 |

完整 SPA assets、session 与读取 transport 可用后才产生 `ready`。新的 publication 只让页面显示更新可用；用户确认后
才切换到新的 cutoff。`closed` 与 `failed` 结束 lifecycle，event 不含 Run facts、cookie 或可复用 credential。

人读启动与关闭见[制作可访问页面](use-case/制作可访问页面.md#观察启动与关闭)；Run 选择与 NDJSON 见
[审阅一次 Run 怎样采用结果](use-case/审阅一次Run怎样采用结果.md#选择要审阅的-run)。

此命令没有持久数据源、SQL、`--out`、部署、分享、Report、Page、theme、renderer、route 或 operation 参数。
