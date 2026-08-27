# PLAN-3 —— Architecture

## 责任边界

| 层 | 拥有 | 不拥有 |
|---|---|---|
| Record Host | operational Store 定位、Snapshot 验证、frozen sealed facts、exact Seal | query JSON、View session、presentation |
| Inspection operations | request/result、selector、cutoff、partial、missing、issues、Evidence、comparison | formatter、route、component、renderer、watcher |
| Query | `niceeval.query/v1` codec 与 correction | 人类文案、View lifecycle |
| Show | 英文终端格式、稳定排序与宽度控制 | selection、denominator、pass rate、score、coverage、Evidence |
| View | loopback server、session、revision、refresh、固定 UI | 重新读取语义、machine protocol、静态 export |

一次 operation 在短 reader Scope 内关闭 plain-data result。Delivery 不能持有 reader、row、content handle 或 Scope token，也不得通过重新读取事实补算结果。

## Source 与 selection

source 是 `project operational Store | RecordSnapshot`，selection 是 `default | exact locator | explicit Run set | operation request`。两者独立组合：`--record` 不改变合法 selector，selector 也不改变 source 的 sealed cutoff 规则。

operational Store 由 Host 在当前 project 中定位。它只提供 sealed facts，View 保留 logical cutoff 而非长事务；publication 到来时只标记 pending，确认 refresh 后才原子切到新 revision。

Snapshot 先被 Host 受限导入。其 metadata 必须声明 `artifactKind: record-snapshot`、schema/format revision、content identity、export provenance、logical closure identity 与 Seal。ordinary SQLite copy、operational Store、open/sealing closure 或缺少字段的文件均不是 Snapshot。验证不执行 implicit migration。

## Comparison

`runs.compare` 只支持 `side-by-side`、`exact` 与 `paired`。side-by-side 分别返回每个集合。exact 先证明 member domain 与 exact member set。paired 只使用第一方 pairing key，并原子返回左右、pair 三份 denominator、unmatched、excluded、partial、missing、issues 与 Evidence。query codec 与 View 都不能补配、隐藏或重算这些字段。

## View 安全与可观察性

View 只监听 loopback。启动 credential 仅用于建立进程期 session；请求验证 Host、Origin 与 session。credential 永不进入 Snapshot、Record、日志持久物或 lifecycle event。

`view --json` 不公开 View RPC 或 inspection result。它只按 NDJSON 写 `niceeval.view-lifecycle/v1` 的 `ready`、`closed` 或 `failed` 事件。事件表明进程状态，不能充当 receipt，也不持久化。
