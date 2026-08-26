# Inspection 架构

## 共享的固定 query definition

Inspection catalog 是读取语义与业务聚合的唯一 owner。它固定包含
`runs.list`、`run.get`、`run.summary`、`attempt.get`、`attempt.trace`、
`attempt.diff`、`attempt.sources`、`attempt.artifacts` 与 `runs.compare`。
catalog 的穷尽 union 是可问问题的边界；它不接受任意 SQL、关系遍历、JSON path、
统计或公式。

每个 query definition 同时拥有以下内容：具名 operation、穷尽 request 与合法 selection、
checked-in SQLite 查询、具名参数绑定、typed row codec，以及把 rows 形成 result 的确定语义。
selection 可以定位 Run、Attempt 或比较两组 Run，却不能把存储 cursor、rowid、文件位置或调用方
page size 作为公开 selector。重 payload 与列表使用有界 domain page；continuation token 绑定
operation、canonical request、source identity 与 sealed cutoff。

row codec 解码 SQLite rows；result meaning 定义 selection audit、分母、缺失、Evidence、
comparison 与限制怎样形成。这两层属于同一 catalog，而不是 Node 侧先投影一份 JSON 给浏览器。
改变 SQL、row codec 或 result meaning 都是同一个 operation 的行为变化，必须与
`behaviorVersion` 一起审计。

`runs.compare` 固定提供 `side-by-side`、`exact` 与 `paired` 三种模式。`exact` 证明
member domain 和 member set 相同。`paired` 只使用第一方 pairing key，并同时交付 left、
right、pair 的 denominator、unmatched、excluded、missing、issues 与 Evidence。

## 两个 SQLite adapter

query definition 与 driver 无关。adapter 只将其中的 checked-in SQLite query 绑定到对应连接，
并把 rows 交给同一 row codec 与 result builder；adapter 不定义另一份 selection、比较或业务聚合。

| adapter | source 与职责 | 不提供 |
| --- | --- | --- |
| Node | `niceeval query` 通过 `node:sqlite` 打开 live operational Record 的 sealed cutoff，或打开指定且已验证的 `RecordSnapshot`。 | HTTP、sqlite-wasm、View UI、session、额外 Snapshot 或 Node-only projection。 |
| Browser | Insight 的 sqlite-wasm Worker 在现有完整 `RecordSnapshot` 上执行同一 query definition。Worker 独占 connection 与 statement lifecycle，并只分派具名 operation 和已验证 request。 | live Record、任意 `execute(sql)`、SQL console、业务 REST、View DTO 或 Snapshot 写入。 |

浏览器中的 React 组件只调用 Insight 暴露的具名读取入口。它们不直接拿 SQLite connection、
statement 或 SQL，也不把每个 route 的结果做成另一套 query。Worker port 是 browser-local adapter
边界，不是对外业务 API。

## 关闭的 result

每次读取都交付一个可编码的 Inspection result。它至少带有以下闭合事实：

| 字段 | 含义 |
|---|---|
| `behaviorVersion` | operation 采用的固定解释语义版本。 |
| `source` | 已验证 source 的内容 identity 与 provenance。 |
| `sealedCutoff` | 本 result 所读取的 exact Seal。 |
| `selection` | request 与实际命中成员的 selection audit。 |
| `result` | operation 所得 Run、Attempt、比较或调试事实。 |
| `limits` | 有界读取已经到达的固定界限与继续读取条件。 |
| `issues` | 缺失、partial 或无法解释的已知问题。 |
| `evidence` | 每项事实可追溯的 Evidence。 |

score、coverage、usage、diagnostics 和 Experiment/Eval overview 都在这个 result 中关闭。
Inspection 决定 member、denominator、缺失与可比性；Insight 用同一 query definition 取得这些
事实，不能在浏览器从 raw runs 猜算 overview、排名、趋势或聚合。machine consumer 也只能呈现
同一闭合结果。

source、selection、sealed cutoff、request 或 `behaviorVersion` 改变时，continuation
不能拼接旧页，operation 返回 restart correction。`limits` 从不静默删去事实，`issues` 也
不能被 consumer 隐藏或改写。

## current schema 与领域结果

Record Host 的迁移与验证先确认 source 使用 current Record schema，Inspection 才创建
`OpenInspectionSource`。旧 schema、迁移失败或无法验证 source 是打开错误，不能被编码为一个已关闭的业务结果。

`not-recorded`、`partial`、`unavailable`、`truncated` 与 `omitted` 都是 current schema 上的领域结果。
它们分别说明事实未采集、只取得一部分、此处不能提供、受有界交付限制，或按 operation 的明确规则省略。每项都带
相应的 selection、limits、issues 或 Evidence；它们不是 schema 兼容、reader 旁路或前端补偿。

## source 生命周期

Node Host 要么定位 project operational SQLite Store，要么验证 sealed-only `RecordSnapshot`。
它随后创建 `OpenInspectionSource`，由它持有短寿的 SQLite reader 与 exact sealed cutoff。
`OpenInspectionSource` 只服务固定 operation；它不迁移输入、不暴露 row、cursor、reader、
Scope 或数据库能力。

Node operation 在 protocol 编码前关闭 reader 与所有内容 handle。未指定 `--record` 时，每次
调用从 operational Store 选择一个 sealed cutoff；`RecordSnapshot` 固定其 exact Seal，
不会 watch 或 refresh。调用方不能把普通 SQLite copy、checkpoint 文件或任意外部文件当作
Snapshot source。

浏览器 adapter 只接收已经形成且完整的 read-only `RecordSnapshot`。提供 SQLite bytes 与保护
其 transport 属于 Insight/Record Host。建立 session、刷新 generation 与关闭 Worker 也由它们拥有；
Inspection 不创建 `InsightSnapshot`、JSON DTO、query cache 或其它中间 artifact。SQLite Snapshot
仅是同一份 sealed Record 的一致只读副本。

Inspection 只拥有 sealed facts 的读取与解释。人读 navigation、表格、drawer、语言、
Preview、Snapshot transport、session 与 Playground 写入规则属于 [Insight](../insight/README.md)。
