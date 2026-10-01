# PLAN-3 —— Lifecycle

## Query

每次 query operation 先定位 source 并读取 request，再打开短的 sealed reader。关闭 operation result 后立即释放 reader、Scope 与 in-flight work。Snapshot 输入先受限验证；任何 migration-required、unsupported 或 invalid input 都在 operation 前失败，不隐式迁移。

## Operational View

View 启动时由 Host 定位 operational Store，建立固定 sealed cutoff 的 candidate revision。candidate 的 overview、navigation 与 stable detail handles 全部准备成功后才成为 active revision；随后 reader 关闭并发出 `ready`。新 sealed publication 只标记 pending。用户确认刷新时，single-flight 建立新 candidate；失败保留 last-good，成功原子替换，旧请求的 identity 不得进入新 revision。

退出停止接收请求和刷新，取消 pending work，再关闭 session、server 与所有 reader。进程退出码与 stderr 表达终态，不另发 lifecycle event。

## Snapshot View

`view --record` 先验证 Snapshot 的 exact Seal 与 metadata，随后在短 reader Scope 内准备固定 revision。它不打开 operational Store，不创建 watcher 或 refresh candidate。其 revision 的 lifetime 只受 View 进程控制，绝不随着 project publication 改变。

## Snapshot creation

`record snapshot --output` 预检空间、deadline 与 source 状态，短暂阻止新 write transaction，等待已开始 transaction 完成后固定 source view。Host 形成 sealed-only target，验证 schema、logical closure identity 与 exact Seal，写齐 artifact metadata 后才提交输出。中断或任何失败关闭资源并留下无可接受 Snapshot 的结果。
