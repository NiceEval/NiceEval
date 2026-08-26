# Inspection CLI

## `niceeval query`

```sh
niceeval query discover [--record <RecordSnapshot>]
niceeval query explain [--record <RecordSnapshot>] --request <file|->
niceeval query run [--record <RecordSnapshot>] --request <file|->
```

`query` 是唯一公开的 CLI 查看命令。它承接原 `show` 的固定读取、筛选、比较与解释结果，
但以 `niceeval.query/v1` 输出结构化结果，而不提供第二个终端 renderer。`niceeval show` 不是
公开命令，也不是 `query` 的别名或兼容入口。浏览器中的人读体验由 [Insight](../insight/README.md) 提供。

`discover` 不读取 request。它输出 compact bootstrap，并按 operation 给出 schema、合法
selector、错误 union 与最小 follow-up request。`explain` 读取完整 request，先交付将读取的
source、selection、comparison mode 与 fact kinds，避免调用方先取重 payload。`run` 读取完整
request 并交付对应的闭合 protocol result。

`--record` 只选择由 `niceeval record snapshot --output` 产生的 sealed-only
`RecordSnapshot`。未给它时，Host 打开 project operational Store 的 sealed cutoff；普通
SQLite copy、checkpoint 或任意外部文件不是 `--record` 输入。

CLI 只在 Node 中运行：它以 `node:sqlite` 对 live Record 或指定 `RecordSnapshot` 执行集中
Inspection query。它不启动 HTTP、sqlite-wasm、浏览器、View session 或额外 Snapshot；`--record`
也不会生成 query 专用的 projection 或 artifact。

`--record` 与 request 的职责正交。前者选择已验证的 SQLite source；后者在固定 operation 的
参数边界内选择 Run、Attempt 或比较集合。命令不接受 SQL、`where`、JSON path、formula、cursor、
rowid、文件位置或调用方指定的 page size。

## machine 输出与错误面

`query` 的 protocol 是 `niceeval.query/v1`。成功和协议级领域失败都恰好向 stdout 写一个
canonical protocol document。它编码 shared query 的 result，带 `behaviorVersion`、source、sealed
cutoff、selection、limits、issues 与 Evidence，说明结果能怎样被解释。

这个 protocol document 只属于 CLI 编码边界，不是 Insight 输入、View DTO、缓存或第二份持久
artifact。浏览器直接在完整 `RecordSnapshot` 上运行相同 operation、参数校验、row codec 与 result
meaning；它不请求或反序列化 `query` stdout。

进度、argv 错误、无法读取 request、无法验证 source，以及无法形成 document 的进程失败只写
stderr 并以非零状态退出。调用方不能根据 stderr 拼接部分 JSON，也不能把 stdout 的 document
与另一 source 或 cutoff 的页混合。

continuation token 绑定 operation、canonical request、source identity 与 sealed cutoff。绑定
改变时，`query` 在 canonical document 中返回 restart correction；调用方必须从新的
discovery 或 request 重新开始。
