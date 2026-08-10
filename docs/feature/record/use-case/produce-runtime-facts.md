# 写入运行事实

本页面向 Runner 和第三方 harness。普通 Eval 作者通过 Eval、Assertion、Judge 和 Sandbox 的上层入口产生数据，不直接拼 Record 文件。

## 开始一次写入

session 只在没有 reader 或受控编辑者并发使用目录时开始。新目录使用 <code>await using session = await createRecordSession(...)</code>。已有停稳目录使用 <code>await using session = await openRecordSession(...)</code>。这个 async-dispose 作用域持有 root operation lock；读取历史用 <code>session.view</code>，写入事实用 <code>session.writer</code>。

先建立 Invocation 的内存身份。在 session 持锁后、execution projector 读取历史前，一次形成尚未发布的 ExecutionTarget。它为每个 Run 绑定 <code>runId</code>、<code>startedAt</code> 和完整 <code>expectedSlots</code>；每个 slot 包含 <code>slotId</code>、<code>evalId</code> 和 attempt 编号。<code>slotId</code> 与 <code>(evalId, attempt)</code> 都在 Run 内唯一。

projector 完成前不得发布目标 Run，避免它参与自己的 source barrier。writer 之后必须原样写入 target 的 identity、时间与 membership，不能重新分配或重新取时。

不要从显示名生成 identity。Run、slot、Attempt 和 Invocation 都使用规范的 128-bit opaque ID。Eval 与 experiment 文本只写进核心字段，不进入目录路径。

## 为每个 slot 形成 Attempt

实际执行的 Attempt 按以下顺序形成：

1. 为 Attempt 分配 identity，并填写 origin 和 eval。
2. 在自己的 <code>.tmp/&lt;writerId&gt;</code> 中写完整目录。
3. 写入 channel 文件和只归该 Attempt 的 blobs。
4. 验证 descriptor、coverage、路径、引用和 <code>attempt.json</code>。
5. 以一次同文件系统目录 rename 发布 Attempt。
6. 在本 writer 临时目录形成、校验并 close Member 普通文件，再以单文件 atomic replace 写入目标 slot。

本 Run 实际执行的 Attempt 使用 <code>executed</code> Member。采用历史 Attempt 时使用 <code>carried</code> 或 <code>accepted</code> Member；它们不改变 Attempt 的 origin。

project-target reuse、explicit adoption 和 execution gap 的理由写到 Run 的 <code>niceeval.actions</code> 通道，并带稳定 policy identity 与 target slot。reuse 还带 <code>attemptId</code>；没有执行 outcome 的 gap 保留 action，但不写 Member。不要给 Member 增加 context、provenance 或 diagnostics 字段。

## 选择通道形态

| 数据特征 | 写入位置 |
|---|---|
| 有序、高频、追加量大，且未知 variant 可保留 | JSONL event channel |
| 单一终态、人工可编辑或随机读取频繁 | document channel |
| 大文本或二进制内容 | Attempt-owned blob |
| Eval source snapshot | Run-owned <code>niceeval.sources</code> manifest 与 Run-local digest blob |

包含 message 与 tool event 的 conversation 和 diagnostics 适合 JSONL。verdict、eligibility、assertions、usage、timing summary、diff 与 commands manifest 适合 Attempt document channel。sources 在 Attempt 执行前写入 origin Run；carried 与 accepted Member 不复制它。

内建名称使用 <code>niceeval.&lt;descriptive-concept&gt;</code>。自定义 JSON fact 使用反向域 namespace，精确 document transport 见 [Architecture](../architecture.md#通道语义与兼容性)。两者都不要以数字后缀表示语义演进，也不要复用已经发布的名称。generic <code>fact()</code> 每个 owner/name 只写一次，完整 document 上限为 65,536 UTF-8 bytes，不支持 JSONL、追加或 blob。

通道暂时不能采集时，写 <code>unavailable/not-collected</code>。不适用时写 <code>unavailable/not-applicable</code>。不要用空文件、空数组或 <code>null</code> 代替这两个状态。

## 结束 Run 与 Invocation

新 Run 核心、Member、descriptor/coverage 更新与 <code>completedAt</code> 都先写入 session writer 的同文件系统临时普通文件，flush/fsync、close 后再 atomic replace。writer 不直接截断正式 JSON；平台缺少所需原语时写入失败。

初始 session 停止拥有 Run 时写入 <code>completedAt</code>。这只标示写入责任结束，不阻止后续人工编辑内容。

Invocation 完成、中断或失败时，Runner 返回 <code>InvocationReceipt</code>。receipt 只包含 Invocation、Run、起止时间和 completion，不携带执行详情。

正常退出只删除自己的临时目录。进程崩溃时留下的临时内容交给停稳后的 owner-aware clean；不要删除其它 writer 的目录。

打开已有 owner 时，writer 原值保留自己未明确写入的 descriptor、channel 文件和 blob。未知或退役 decoder 不授权删除文件；既有 descriptor 无法安全读出时，该 owner 保持只读。

## 常见边界

| 错误做法 | 正确做法 |
|---|---|
| 把 Report 页面字段写回 Record | 由 composition adapter 形成 ReportInput |
| 让一个 Member 复制 Attempt 的 verdict 或 usage | Member 只引用 Attempt |
| 把 rename 写成新的 Member kind | 在 Run 通道写入 rename 事实 |
| 用不同 duration domain 的数值比较 timeout | 视为不可采用 |
| 给已发布通道原地改变含义 | 发布新的描述性通道或 event 名 |
| 在正式 Attempt 路径逐个写文件 | 先在临时目录完整形成，再一次发布 |

写入完成后离开 <code>await using</code> 作用域。dispose 等待在飞写入，关闭 view 与 writer 句柄，删除本 writer 未发布的临时内容，然后释放 operation lock。随后 reader 才在停稳目录上打开 Record。进程崩溃无法执行 dispose 时，现场留给 owner-aware clean。
