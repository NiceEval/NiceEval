# PLAN-3 —— CLI

```sh
niceeval query discover [--record <RecordSnapshot>]
niceeval query explain [--record <RecordSnapshot>] [--request <file|->]
niceeval query run [--record <RecordSnapshot>] [--request <file|->]

niceeval show [--record <RecordSnapshot>]
niceeval show --run <run-id>... [--record <RecordSnapshot>]
niceeval show @<locator> [--source | --execution [--expand <stable-id>]] [--record <RecordSnapshot>]

niceeval view [@<attempt-locator> | --run <run-id>...] \
  [--record <RecordSnapshot>] [--no-open] [--port <port>]

niceeval record snapshot --output <snapshot>
```

这些是公开运行后命令。`insight`、`view --out`、static export 与兼容 alias 都不是有效语法。

## Show

`show` 只把 `overview.get`、`run.get` / `run.summary`、`attempt.get`、`attempt.sources`、
`attempt.trace` / `attempt.trace.detail` 的闭合结果排成英文终端文本。renderer 只拥有排序、宽度与布局，
不重选成员或重算 denominator、pass rate、score、coverage 与 Evidence。`--expand` 只接受
trace outline 暴露的稳定 identity。它不提供 JSON、Report、自由统计、旧位置 handle 或作者呈现参数。

## Query

`query` 的 stdout 始终只写一个 `niceeval.query/v1` canonical machine document。`discover` 没有 request body；`explain` 与 `run` 从 `--request <file|->` 读取完整 request。进度、argv 错误与无法编码的进程失败只写 stderr。

`discover` 先给 compact bootstrap，再按 operation 给 schema、合法 selector、comparison mode、错误 union 与最小 follow-up request。`explain` 关闭 selection、handle、comparison mode 和需要的 fact kinds，不读重 payload。`run` 执行具名 operation。continuation token 绑定 operation、canonical request、content identity 与 sealed cutoff；过期时返回 restart correction。

## View

没有 selector 的 `view` 打开默认 overview；`@locator` 打开 exact Attempt detail；一个或多个 `--run` 打开 Run selection。`--record` 只换 source，不是 selector。`--no-open` 使进程不请求 OS 打开浏览器；`--port` 选择 loopback port。

完整 View 可用后，stdout 写出一次人读 ready URL。自动化使用独占端口等待 HTTP readiness，并以退出码与 stderr 观察失败；View 不提供 lifecycle machine protocol。

## Snapshot

`record snapshot --output` 形成 sealed-only `RecordSnapshot`。目标若不能安全写入、source 正在超出 deadline 的 snapshot barrier 或 exact Seal 验证失败，命令失败而不留下可被接受的 artifact。Snapshot 的可移植性不表示其内容已按接收者业务规则脱敏。
