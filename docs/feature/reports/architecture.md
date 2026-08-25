# Inspection 与 Delivery 架构

## Operation

Inspection Operations 是唯一的读取语义 owner。每个 operation 以穷尽 request/result 关闭 selector、sealed cutoff、selection audit、partial、missing、issues、Evidence 与 comparison。结果只含可编码 plain data；reader、Scope、Content handle、row 与数据库能力在 operation 返回前关闭。

`runs.compare` 的 `side-by-side` 分别交付各集合。`exact` 必须证明相同 member domain 与 member set。`paired` 只使用第一方 pairing key，并原子交付 left、right、pair 三份 denominator、unmatched、excluded、missing、issues 与 Evidence。

## Source

source 是 operational Store 或 `RecordSnapshot`，并与 operation selection 正交。Host 定位 operational Store 后建立短 sealed reader；长寿 View 只保留 logical cutoff，不持有长事务。Snapshot 必须有 `artifactKind: record-snapshot`、schema/format revision、content identity、export provenance、logical closure identity 与 exact Seal。Host 受限验证后才形成 reader generation；Inspection 从不迁移输入。

## Delivery

query 的 codec 只处理 `niceeval.query/v1` request/result。View 只拥有 loopback transport、session、active revision、refresh 与固定 UI。两者均不能重新读取 facts 或共享呈现实现。

Operational View 的 candidate revision 准备完整后才原子替换 active revision；失败保留 last-good。Snapshot View 不建立 watcher 或 refresh。View 只监听 loopback，并校验 session、Host 与 Origin。credential 不能写入 Record、Snapshot、receipt 或 lifecycle events。

`view --json` 仅输出 `niceeval.view-lifecycle/v1` NDJSON `ready`、`closed`、`failed`。它不是 query result，也不持久化。
