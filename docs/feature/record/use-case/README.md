# Record 用例

契约单源在 [Record Library](../library.md)、[Architecture](../architecture.md)、[Lifecycle](../lifecycle.md) 与
[CLI](../cli.md)。本目录按用户目标串联这些能力。

## 按目标进入

| 用户目标 | 用例 |
|---|---|
| Host 收集事实并以 final transaction 发布一个完整 Run | [发布完整 Run](发布完整运行.md) |
| 跨多次 send 把 plain-data item 流式接纳、显式 close 并按需流式读回 | [多次 send 怎样收集 Attempt 事实](多次send怎样收集Attempt事实.md) |
| 选择 Attachment owner、family、Content 与 generic-row closure | [Attachment 怎样保存运行事实](RecordAttachment怎样保存运行事实.md) |
| 调整 matcher、Inspection 或 Delivery 而不改 Record facts | [上层变化不改持久格式](上层变化不改持久格式.md) |
| 在新 family、family migration、physical schema 与 Core 之间选边界 | [选择正确的持久边界](未来功能不扩张核心格式.md) |
| 让多个 Attempt 与 reference Run 共享 origin Run 的源码事实 | [多个 Attempt 怎样共用源码快照](多个Attempt怎样共用源码快照.md) |
| 把项目 import 与 loader input 纳入源码闭包 | [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md) |
| 演进 Sources facts，同时区分 family/data 与 physical schema migration | [源码 Attachment 怎样安全演进](源码Attachment怎样安全演进.md) |
| 迁移 operational database 并生成可交给 Git 的 Snapshot | [显式 migration 与 Snapshot 边界](显式迁移Record-major.md) |

两个 `niceeval exp` process 可以同时创建不同 Run。它们共享 SQLite WAL writer，但每个 process 的 dedicated worker 先通过
ProjectDatabase 内 Host-only coordination tables 的 per-root admission ticket，再只提交一个 bounded batch。reader 始终只选择
sealed Run；execution claim 不进入 Record rows 或 Snapshot，snapshot target 会 scrub 本机 coordination。
