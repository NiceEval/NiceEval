# Eval —— 架构

设计原因和作者面分别见 [README](README.md) 与 [Assertions](../assertions/README.md)。

## 接收者决定 scope

同一 scoped Assertion 词汇绑定在 `t`、Session 与 Turn。receiver 决定读取的 call-time snapshot：根 `t`
读取已启动 Session 的 vector cut，Session 读取自己的前缀，Turn 读取不可变 Turn。词汇本身没有第二套
按名字选择 scope 的语义。

## 按源码顺序登记

文件上传、Agent Turn、命令和 Assertion 都按 `test(t)` 的 TypeScript 顺序执行。调用作者入口时就冻结
subject、callsite、source order 与 groupPath；后续配置只作用于同一 entry。

`.orStop()` 只终止当前 awaited continuation。已登记或已启动的 evaluator 仍结算，未执行的源码不会生成
结果。普通 JavaScript 副作用和此前启动的并发任务不会被回滚。

## 两种 grading

Pass Eval 与 Score Eval 的 Assertion 都封口到 `niceeval.assertions` family 的 persistence revision `3` envelope。Verdict 在读侧折叠 Core
`outcome`、sealed Assertions 与显式 skip；它不从分数推导，Score 也不从 Verdict 推导。

Score Eval 的显式 contribution 将 `points`、earned 与完整度输入封口到 Assertion entry。Score 按同一份
rubric 在读侧汇总；缺少必要材料时保留 partial 或 unavailable，不写第二份持久化结果。两种 Eval 共享
AssertionResult、evidence、snapshot 与读取协议，差别只在主读数和 score 规则。

Report 与 Analysis 打开 `Sample` 后，以 `query()` 或 `aggregate()` 取得闭合结果及其中的 `MetricValue`。
它们只读 Core 与 Assertions 的已封口事实，不重新执行 evaluator 或创建另一条结果通道。

## 文件传输与生命周期

起始文件在第一次 `send` 前通过普通 Sandbox API 上传。测试文件可在某个 `send` 返回后上传，随后下一轮
会看见它。文件相对 send 的位置决定可见性。

eval 的 before action 在 `sandbox.before` 运行，随后是 `eval.run` 与 Assertion evaluation。after failure 只
追加 diagnostic，不自动改写已经可计算的 grading。execution outcome、Assertions 与 diagnostic 的归属分别见
[Record · Core v1](../record/architecture.md#core-v1)、[Assertions](../assertions/README.md) 与
[Observability · Diagnostics](../record/architecture/observability-attachments.md#diagnostics)。
