# Insight CLI

## `niceeval view`

```sh
niceeval view [--run <run-id>...] [--no-open] [--port <port>]
```

`niceeval view` 是 Insight 的唯一命令面。它准备 SPA、本机授权 session 与 generation-bound Inspection endpoint，然后打开
浏览器。薄 Node Host 固定 `PublicationCutoff`、只读查询 SQLite，并返回正式 Inspection result；浏览器不下载 Record，
命令也不生成业务 JSON 或 View DTO。

| 参数 | 行为 |
| --- | --- |
| `--run <run-id>` | 预选一个或多个 exact Run；详情继续由页面 URL 定位。 |
| `--no-open` | 准备受保护的 loopback View，但不请求 OS 打开浏览器。 |
| `--port <port>` | 选择 `127.0.0.1` listener 的端口。 |

完整 SPA assets、session 与读取 transport 可用后，命令向 stdout 写出一次可打开的 loopback URL。新的 publication
只让页面显示更新可用；用户确认后才切换到新的 cutoff。启动或运行失败通过退出码与 stderr 反馈。

启动与关闭见[制作可访问页面](use-case/制作可访问页面.md#观察启动与关闭)；Run 选择见
[审阅一次 Run 怎样采用结果](use-case/审阅一次Run怎样采用结果.md#选择要审阅的-run)。

此命令没有持久数据源、SQL、`--out`、部署、分享、Report、Page、theme、renderer、route 或 operation 参数。
