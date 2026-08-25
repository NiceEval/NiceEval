# Record 用例

契约单源始终在 [Record Library](../library.md)、[Architecture](../architecture.md) 与
[CLI](../cli.md)。本目录只组合这些契约，不重新定义字段、错误或磁盘格式。

## 两个实验并行追加

两个 shell 可以同时运行不同条件：

```text
shell A: niceeval exp memory-off
shell B: niceeval exp memory-on
```

两者各自以 shared append lease 创建新 RunId，并排他创建自己的目录：

```text
.niceeval/record/runs/
├─ 01K...A/   writer A only
└─ 01K...B/   writer B only
```

它们不会更新 root manifest、计数器、`latest` 或共享 summary，所以不互相阻塞。每个 Run 只等待
自己的 Attempt 和 collector；`complete` 出现后，下一次 `selectRuns()` 才能整体看到该 Run。

同一 logical Slot 的跨 Invocation 去重不靠 Record writer lock。Experiment 在 dispatch 时取得
execution claim，重新读取已封口历史，再决定引用或执行。承载新 Attempt 的 Run durable seal 后才
释放 claim，避免另一个 Invocation 在 marker 出现前重复执行。

## 按目标进入

| 用户目标 | 用例 |
|---|---|
| 内部 producer 创建 Attempt、收集固定事实并发布 Run | [发布完整 Run](发布完整运行.md) |
| Host/capture producer 跨多次 send 与 Agent Session 追加简单 Attempt 事实 | [多次 send 怎样收集 Attempt 事实](多次send怎样收集Attempt事实.md) |
| 理解五个固定 family、owner-local closure、File Changes 轨迹和惰性读取 | [Attachment 怎样保存运行事实](RecordAttachment怎样保存运行事实.md) |
| 调整 matcher、Analysis 或 Report 而不扩张 Record | [上层变化不改持久格式](上层变化不改持久格式.md) |
| 选择 Analysis、固定 family 或 Core 的正确边界 | [未来功能不扩张核心格式](未来功能不扩张核心格式.md) |
| 让多个 Attempt 和 reference Run 读取同一源码快照 | [多个 Attempt 怎样共用源码快照](多个Attempt怎样共用源码快照.md) |
| 把本地 import 与 loader 输入纳入源码闭包 | [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md) |
| 演进 Sources 而不伪造历史事实 | [源码 Attachment 怎样安全演进](源码Attachment怎样安全演进.md) |
| 识别格式、运行可续跑 migration，并自行用 Git 保存历史 | [显式 migration](显式迁移Record-major.md) |

统计解释进入 Analysis；终端、网页与静态呈现进入 [Reports](../../reports/README.md)。
