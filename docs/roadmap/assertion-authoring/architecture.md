# Assertion 作者面 —— 架构

规范语义在 [Assertions](../../feature/assertions/README.md)。实现以一个 Attempt collector 管理每次作者入口
调用产生的 entry。

## 登记与封口

登记时冻结 subject 或 scope snapshot、evaluator、callsite、source order 和 groupPath。handle 只可配置
尚未封口的 policy；evaluator 可立即开始，其 evaluation 对同一 entry memoize 一次。

`.orStop()` 封口当前 entry。test settle 封口其余 entry。封口后配置、重复 key 或 label、以及 detached
async 配置都是作者错误。

## 两种 projection

Pass projection 要求所有 measurement 有 `.atLeast(n)`，并折叠 Attempt Verdict。Score projection 只累计
显式 `scoreContribution`；record-only Assertion 仍保留 evidence 与 Issue，但不自动贡献数值。

Score control stop 的 normal mismatch 或 below 仍得到 `scored` grading、正式 score 与 stop cause。执行错误
或参与 score 的 evaluator 不可用时，保留 `partialScore` 并标记不可排名。

## scope

根 `t`、Session 与 Turn 都是 call-time snapshot。根 subject 使用已启动 Session 的 vector cut，不能读取
last status。Session 在第一次交互开始时加入根；空 handle 不加入。

## Result 协议

`AssertionResult` 是 entry 的唯一持久化结果。它保存 stable id、定位、typed snapshot ref、evaluator
identity / version 与完整安全 structured config。它还保存 evaluation union、versioned evidence envelope、
policy 及 pass 或 score projection。

evidence envelope 必须带最小判定见证、coverage、payload、refs 与 limitations。它不能退化成成功 / 失败
或预制展示字符串。完整边界见
[Assertion 可解释闭包](../../feature/assertions/architecture.md#assertion-可解释闭包)。
