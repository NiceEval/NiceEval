# Record：可编辑事实数据集

Record 是 <code>&lt;project&gt;/.niceeval/record/</code> 中可编辑的事实数据集。一次评估形成的 Run、成员关系、Attempt 和通道数据都在这里。人和工具只在目录停稳时读取或编辑它。

它不是防伪账本，也不保存编辑历史、修订号或 revision。一次读取得到的内容可以在下一次命令前被写入器或人工改变。文件形状、身份、路径和引用校验只用于拒绝自相矛盾的数据。

Record 不判断事实是否“当前”、过期、可复用或需要再次执行。用户指定范围、当前 Project Target、fingerprint 和本次 policy 都是投影输入。它们由 [Sample](../sample/README.md) 的 analysis projector 或 [Experiments](../experiments/cache.md) 的 execution projector 解释，不写进 Record 核心。

## 核心心智

Run 定义本次运行应包含哪些 slot，因此决定分母。Member 将一个 slot 采用到一个 Attempt。Attempt 保存实际执行产生的细节；一个 Attempt 被编辑后，所有采用它的 Member 在下一次读取时都会看到新值。

carry、accept 与 rename 的理由不写入 Member。它们是 Run 的局部通道事实，并以 slotId 和 attemptId 关联。Attempt 始终保有自己的 origin，不会因被采用而改挂到另一个 Run。

Invocation 只是 Runner 或 Library 的返回身份。它没有持久化目录；<code>InvocationReceipt</code> 也不复制 locator、Verdict、用量、费用或计数。

```text
record files
    ├─ RecordReader → analysis projector → AnalysisSample → ReportInput → Reports
    └─ RecordSession.view → execution projector → reuse | gap
                                                 ├─ gaps → planner / scheduler
                                                 └─ projection + outcomes → writer
```

RecordReader 与 RecordSession.view 只提供经过校验的事实读取。选择范围、复用资格和缺口原因由对应 projector 拥有；writer 只验证并落盘已经决定的 executed、carried 或 accepted 事实。

Reports 的 composition adapter 按 ReportPlan 读取磁盘字段。Report 定义、页面、view 与 export 只消费内存输入或执行结果，因此不会成为另一套文件解释器。

## 演进方式

根文件的格式名固定为 <code>niceeval.record</code>。reader 只解释这个精确格式；其它根文件统一返回 <code>record-format-invalid</code>。

这里没有全局整数格式版本字段。核心协议冻结后，破坏性领域演进使用永不复用的语义身份，并只让相关通道局部失效。新 reader 必须读取所有核心形状有效的 <code>niceeval.record</code>；它可以把未知或已退役通道报告为不支持。

这不是“完全无版本”。格式名、核心身份和目录协议仍是稳定边界。只有它们无法保持解释时才更换整个格式名；普通领域变化不能让所有历史 Record 一起失效。

## 范围

Record 定义根目录、Run / Member / Attempt 的核心文件、operation lock、单锁 RecordSession、通道、原子发布和单通道四态读取。它也定义受控删除与 owner-aware 的临时目录删除。

Record-to-Record 的发布、复制、镜像和同步不属于本功能。分享由自包含的静态 Report export 负责。它脱离源 Record 后呈现固定内容，不把 producer 身份认证或可再次查询的承诺交给 Record。

运行中的终端反馈和旁路查看由 Runner 负责。<code>show</code>、<code>view</code>、导出和人工编辑都只面对停稳目录。

## 入口

- [Architecture](architecture.md)：文件布局、核心形状、身份、通道、发布和演进不变量。
- [Library](library.md)：创建或打开 reader / writer、通道读取和 typed error。
- [CLI](cli.md)：项目 root、<code>show</code>、<code>view</code> 与临时目录删除。
- [Use case](use-case/README.md)：Runner 或第三方 harness 写入运行事实的路径。
- [Reference](reference/README.md)：外部研究索引，不定义产品契约。
