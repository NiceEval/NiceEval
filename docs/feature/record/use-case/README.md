# Record 用例

这里按写入者的目标串起路径。字段、目录、读取状态和错误的唯一正文分别是 [Architecture](../architecture.md) 与 [Library](../library.md)。

| 用户目标 | 进入 |
|---|---|
| 让 Runner 或第三方 producer 发布一轮完整 Run | [发布完整 Run](发布完整运行.md) |
| 给持久能力选择 Channel、projector 或 Record major | [选择正确的演进边界](未来功能不扩张核心格式.md) |
| 调整 Assertion evaluator、Plugin 或 Report 而不扩张 Core | [上层变化不改持久格式](上层变化不改持久格式.md) |
| 理解 source、conversation 与 timing 等运行事实怎样落盘 | [Channel 怎样保存运行事实](Channel怎样保存运行事实.md) |
| 把旧 Record major 显式转换到 current major | [显式迁移 Record major](显式迁移Record-major.md) |
| 让多个 Attempt 读取同一个 origin Run 源码快照 | [多个 Attempt 怎样共用源码快照](多个Attempt怎样共用源码快照.md) |
| 保存调用本地评分函数的 Eval 源码闭包 | [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md) |
| 在不重写历史事实的前提下升级源码 Channel | [源码 Channel 怎样安全演进](源码Channel怎样安全演进.md) |

选择可比较对象进入 [Sample](../../sample/README.md)。终端与网页呈现进入 [Reports](../../reports/README.md)。
