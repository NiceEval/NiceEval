# Inspection CLI

## `niceeval query`

```sh
niceeval query discover [--record <RecordSnapshot>]
niceeval query explain [--record <RecordSnapshot>] --request <file|->
niceeval query run [--record <RecordSnapshot>] --request <file|->
```

`query` 是 machine-only `niceeval.query/v1` 协议。成功或协议级领域失败恰好向 stdout 写一个 canonical document；进度、argv 错误和无法形成 document 的进程失败只写 stderr。`discover` 不读 request；`explain` 与 `run` 从 `--request` 读取完整 request。

discovery 给 compact bootstrap，再按 operation 给 schema、合法 selector、错误 union 与最小 follow-up request。continuation token 绑定 operation、canonical request、content identity 与 sealed cutoff；绑定变化返回 restart correction。

## `niceeval view`

```sh
niceeval view [--run <run-id>...] \
  [--record <RecordSnapshot>] [--no-open] [--port <port>] [--json]
```

无 selector 打开默认 overview；`--run` 选择一个或多个 Run。固定第一方页面从 overview 的 Run/Attempt 导航进入
exact Attempt detail；CLI 不接受 positional Attempt locator。locator 仍是 Attempt 的数据 identity。

`--record` 只选择 source。`--no-open` 不请求 OS 打开浏览器；`--port` 选择 loopback port。

`--json` 只输出 lifecycle-only `niceeval.view-lifecycle/v1` NDJSON。`ready` 含受保护 loopback URL 及其一次性 fragment
credential；调用方必须脱敏，不能上传原始 stdout。`closed` 与 `failed` 不含 cookie、credential 或可复用 session material。

`view` 不提供 `--out`、部署、分享或自定义呈现参数。

固定 renderer 产出的 `ViewRevision` 在符合官方 Preview 条件时可由主仓的 Netlify Preview 静态服务；构建复用被精确 pin 的 `NiceEval-Preview` consumer。`niceeval view` 不选择该服务，也不能写用户导出目录。

它不接受 Page、component、theme、renderer、route 或 operation。

## `niceeval record snapshot`

```sh
niceeval record snapshot --output <snapshot>
```

命令形成经 Host 验证的 sealed-only `RecordSnapshot`。普通 store copy、checkpoint 后 SQLite 文件或任意 external file 都不是可接受的 `--record` 输入。Snapshot 可携带的内容仍由分享者按业务风险判断；storage sanitization 不等于业务脱敏。
