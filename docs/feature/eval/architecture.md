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

Pass Eval 与 Score Eval 都折叠 Attempt Verdict。Score Eval 另行累计显式 score contribution，并写独立
Score Attachment；Verdict 不从分数推导，分数也不从 Verdict 推导。两者共享 AssertionResult、evidence、
snapshot 与读取协议；不同之处只在主读数和 score projection。

## 文件传输与生命周期

起始文件在第一次 `send` 前通过普通 Sandbox API 上传。测试文件可在某个 `send` 返回后上传，随后下一轮
会看见它。文件相对 send 的位置决定可见性。

eval 的准备命令在 `sandbox.prepare` 运行，随后是 `eval.run` 与 Assertion evaluation。cleanup failure 只
追加 diagnostic，不自动改写已经可计算的 grading。完整 Result 生命周期见
[Record](../record/architecture.md#resultjson)。
