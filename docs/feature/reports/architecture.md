# Inspection 与 Delivery 架构

## Operation

Inspection Operations 是唯一的读取语义 owner。每个 operation 以穷尽 request/result 关闭 selector、sealed cutoff、selection audit、partial、missing、issues、Evidence 与 comparison。结果只含可编码 plain data；reader、Scope、Content handle、row 与数据库能力在 operation 返回前关闭。

`runs.compare` 的 `side-by-side` 分别交付各集合。`exact` 必须证明相同 member domain 与 member set。`paired` 只使用第一方 pairing key，并原子交付 left、right、pair 三份 denominator、unmatched、excluded、missing、issues 与 Evidence。

## Source

source 是 operational Store 或 `RecordSnapshot`，并与 operation selection 正交。Host 定位 operational Store 后建立短 sealed reader；长寿 View 只保留 logical cutoff，不持有长事务。Snapshot 必须有 `artifactKind: record-snapshot`、schema/format revision、content identity、export provenance、logical closure identity 与 exact Seal。Host 受限验证后才形成 reader generation；Inspection 从不迁移输入。

## Delivery

query 的 codec 只处理 `niceeval.query/v1` request/result。

Web View 的固定 renderer 对 pinned sealed synthetic `RecordSnapshot` 生成 immutable、byte-complete、多文件 `ViewRevision`。它恰有 `overview`、`run`、`attempt`、`compare`、`sources` 与 `artifacts` 页面及其资源，不能添加任意 route、operation、Page 或 renderer。

byte-complete 要求规定文件全集一次生成且不可变；它不承诺无界 payload 全量内联。

固定 delivery limit 命中时，页面必须显式交付 `truncated`、边界与下一步的固定读取路径。它不得修改 operation 的 `partial`、`missing`、`issues`、Evidence 或 comparison result。

本地 loopback 和公开 Preview 都逐字节服务同一个 `ViewRevision`。loopback 的 session、Host 与 Origin 校验只包在 transport 外层；revision transport-neutral，不能含 credential、cookie、fragment credential 或任何 session auth。query 与 Web View 均不能重新读取 facts 或共享呈现实现。

公开 Preview 仅是 `NiceEval-Preview` 官方 `main` 对精确 NiceEval candidate SHA 的部署/视觉 dogfood。

它的发布输入只能是 `ViewRevision` files。它禁止 SQLite、Inspection JSON、`.niceeval`、Snapshot 与 secrets，运行面没有 Functions 或长期 Node。

candidate SHA 绑定可信的 renderer candidate，不把 Record 内容或任意外部 URL 变成受信输入。

Preview 不新增 Record 格式或 user static export。它不允许自定义 Report、Page、component、theme、renderer、route 或 operation。

新 Netlify site/check 属于 `NiceEval-Preview`，不属于主仓 PR。旧 site/check 在新站验活后由外部 owner 移除。

Operational View 的 candidate revision 准备完整后才原子替换 active revision；失败保留 last-good。Snapshot View 不建立 watcher 或 refresh。`niceeval view` 的 server 只监听 loopback，并校验 session、Host 与 Origin；公开 Preview 只静态服务它收到的 revision files，不会把这个 server 公开。credential 不能写入 Record、Snapshot、receipt、lifecycle events 或 `ViewRevision`。

`view --json` 仅输出 `niceeval.view-lifecycle/v1` NDJSON `ready`、`closed`、`failed`。它不是 query result，也不持久化。
