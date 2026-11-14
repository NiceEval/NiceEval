# Insight CLI

## `niceeval view`

```sh
niceeval view [<对象>] [<方面>] [<ID>] [--no-open] [--port <port>]
```

`niceeval view` 是 Insight 的唯一命令面。它准备 SPA、本机授权 session 与 generation-bound Inspection endpoint，然后打开
浏览器。薄 Node Host 固定 `PublicationCutoff`、只读查询 SQLite，并返回正式 Inspection result；浏览器不下载 Record，
命令也不生成业务 JSON 或 View DTO。

| 参数 | 行为 |
| --- | --- |
| 省略对象 | 打开当前 Results，与默认 `show` 读取同一个 `project.get`。 |
| `@<locator>` | 直接打开该 Attempt 的详情，与复制的 Attempt URL 硬加载时显示同一内容。 |
| `@<locator> <方面>`、`@<locator> <ID>` | 打开该 Attempt 详情中对应的区段或条目，例如 `view @<locator> fc_<id>` 打开这个改动文件的 diff。 |
| `run:<run-id>` | 预选一个或多个 exact Run；详情继续由页面 URL 定位。 |
| `exp:<experiment-id>` | 在 Results 中预选一个或多个 Experiment，范围与 `show exp:<experiment-id>` 相同。 |
| `--no-open` | 准备受保护的 loopback View，但不请求 OS 打开浏览器。 |
| `--port <port>` | 选择 `127.0.0.1` listener 的端口。 |

对象、方面与 ID 的写法、ID 前缀表与组合规则都与 [`niceeval show`](../inspection/cli.md#对象方面与-flag-的组合) 相同：把 `show` 换成 `view`、参数不变，就在浏览器打开同一个位置。它们在启动时于同一 `PublicationCutoff` 上校验；任一 ID 或 locator 未命中、方面与 ID 前缀不符时，命令以英文诊断写 stderr 并非零退出，不打开浏览器。`show` 的方面专属 flag（`--actor`、`--reprice` 等）、`--json`、`--record` 与断言图片不被 `view` 接受。

完整 SPA assets、session 与读取 transport 可用后，命令向 stdout 写出一次可打开的 loopback URL。新的 publication
只让页面显示更新可用；用户确认后才切换到新的 cutoff。启动或运行失败通过退出码与 stderr 反馈。

启动与关闭见[制作可访问页面](use-case/insight-create-accessible-page.md#观察启动与关闭)；Run 选择见
[审阅一次 Run 怎样采用结果](use-case/insight-review-run-adoption.md#选择要审阅的-run)。

此命令没有持久数据源、SQL、`--out`、部署、分享、Report、Page、theme、renderer、route 或 operation 参数。
