# Assertion 作者面

## 解决的问题

NiceEval 已把值 matcher、作用域检查、Sandbox 验证与 Judge 汇入同一种 `AssertionResult`。
真实多轮 eval 仍会在五个接缝失去类型或证据语义：

- `eventOrder` 只能排列事件类型，不能同时约束工具名、入参、状态与 assistant message；
- count predicate、pending operation 与多 session 聚合会在 partial evidence 上产生含糊结果；
- `t.require` 不能把 type predicate 的收窄结果和计分项写入同一条 Assertion；
- 浮空 `.stopOnFailure()`、手写 `JSON.stringify` 与 eager file read 会把作者错误、候选失败和材料整形混在一起；
- `AssertionResult.name` 同时承担 scope 前缀、作者标题和 matcher 摘要，读取面无法可靠投影。

目标作者面必须完整表达 NiceEval-Eval 的 `add-regression` 回归题。
该题的 18 条检查仍各自产生一条 `AssertionResult`，总可得分保持 34，七条 Judge 不合并。

## 核心心智

Assertion 继续保留三个入口：

| 入口 | 负责的事实 |
|---|---|
| 值 matcher | 作者显式传入的 TypeScript 值 |
| scope assertion | turn、session 或 attempt 的标准事实与证据完整度 |
| Judge | 需要模型按 rubric 评价的开放式标准 |

值 matcher 是不可变值；每个 modifier 返回新 matcher。
已经登记的 handle 则配置同一条 pending Assertion，直到 finalize、`t.require` 或 awaited `.stopOnFailure()` 开始求值。

`.label()` 只提供人读标题，不是跨运行身份。
跨 eval 比较继续读取 `groupPath`；turn/session/attempt 归属写入结构化 `scope`。
Judge 已有 required `name`，因此 Judge handle 不再暴露第二个标题入口。

工具与子 Agent 的 start、finish 在同一 session 内合成 logical occurrence。
`toolOrder` 回答发起子序，`eventOrder` 回答前一项结束后下一项才开始；两者不共享排序算法。
attempt 级 order 只要求某一条 session 内存在完整链，绝不把并发 session 的半链拼在一起。

证据仍使用 `passed | failed | unavailable`。
显式匹配到的正事实可以在 partial channel 上通过；缺少完整事实时，负断言、pending 与依赖最终总数的检查不会静默给出结果。

## 范围

包含：

- 统一 `.label()`、handle 冻结、awaited `.stopOnFailure()` 与 typed `t.require`；
- `CountMatch`、`EventMatch`、logical occurrence、两种 order 与 receiver-aware `eventsSatisfy`；
- custom Assertion 的结构化 evaluation、AbortSignal 与 defect 边界；
- turn 级 changes assertion、aggregate `noChanges()` 与 delayed file 三分语义；
- `AssertionResult.scope`、`nameKind`、统一展示投影与 grouped recorded-turn evidence；
- `material.json()` 与 binary Judge score mode 在原生 LLM Judge Runtime 的扩展；
- `add-regression` 的 34 分守恒用例。

不包含：

- 只因表面对称增加 `requireToolCall`、`requireSubagentCall` 或 `requireEvent`；
- session 级 changes、turn 上的 Sandbox 操作或第二次 diff 采集；
- 跨 session 的全局事件顺序；
- count predicate、通用 EventMatch text predicate 或浮空 Promise 结算；
- `includesUrl`、`hasSections`、`noFailedShellCommands` 等可由通用词汇表达的业务版式别名；
- 在 Assertion 包内复制 Judge Provider、材料规范化或 binary response schema。

## 入口

- [Library](library.md) —— matcher、scope assertion、handle、require 与 Sandbox 作者面。
- [Architecture](architecture.md) —— occurrence、coverage、Record、求值边界与展示投影。
- [Use Case](use-case/README.md) —— 真实题目的完整迁移与分值守恒。
- [Research](../../research/eve-assertion-dx.md) —— Eve DX 与逐项断言审视。
