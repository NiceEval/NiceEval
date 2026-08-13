# Record 用例

这里按写入者和维护者的目标串起完整路径。字段、目录、读取状态和错误的唯一契约分别在 [Architecture](../architecture.md)、[Library](../library.md) 与 [CLI](../cli.md)。

| 用户目标 | 进入 |
|---|---|
| 让内部 Runner / 官方 producer 发布一轮完整 Run | [发布完整 Run](发布完整运行.md) |
| 给持久能力选择 RecordAttachment、projector 或 Record major | [选择正确的演进边界](未来功能不扩张核心格式.md) |
| 调整 Assertion evaluator、Plugin 或 Report 而不扩张 Core | [上层变化不改持久格式](上层变化不改持久格式.md) |
| 理解 source、conversation 与 timing 等运行事实怎样落盘 | [RecordAttachment 怎样保存运行事实](RecordAttachment怎样保存运行事实.md) |
| 把旧 Core 与 RecordAttachment 显式迁移到 current version | [显式 migration](显式迁移Record-major.md) |
| 让多个 Attempt 读取同一个 origin Run 源码快照 | [多个 Attempt 怎样共用源码快照](多个Attempt怎样共用源码快照.md) |
| 保存调用本地评分函数的 Eval 源码闭包 | [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md) |
| 在不伪造历史事实的前提下升级源码 RecordAttachment | [源码 RecordAttachment 怎样安全演进](源码Attachment怎样安全演进.md) |

选择可比较对象进入 [Sample](../../sample/README.md)。typed projection 与终端、网页呈现分别进入 [Projection](../../projection/README.md) 与 [Reports](../../reports/README.md)。
