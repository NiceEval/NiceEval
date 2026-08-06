# 有序 Eval 序列

## 解决的问题

Eval 的文件路径适合生成稳定身份，也适合选择一组题目。
但路径的字典序不能证明多道 Eval 构成一条有效执行历史。
数字文件名前缀配合 `maxConcurrency: 1` 只能让当前 Invocation 依次派发，不能阻止结果沿用跳过前序步骤，也不能阻止用户只选择后置 Eval。

需要前序交互或状态的评测因此把一份执行契约拆进文件名、Experiment 并发配置、metadata 与说明文档。
Runner 只看到多条普通 Attempt，读取面也无法区分完整序列中的结果与脱离历史单独运行的结果。

## 核心心智

**Sequence 是一组现有 Eval 的有序执行声明。**
Eval 身份继续由 `evals/` 下的文件路径生成；Sequence 身份由 `sequences/` 下的文件路径生成。
Sequence 只引用 Eval ID，不复制 Eval，不给 Eval 增加第二个身份。

一次 Sequence Invocation 从第一步开始，按声明顺序逐步真实执行。
Sequence 不使用历史结果沿用，不把文件名字典序当执行契约，也不根据业务 metadata 猜测步骤行为。
选择序列中的某个终点时，Runner 仍从第一步重放到该终点。

Sequence 不声明 `role`、learn、update、revoke 或 checkpoint。
这些词描述特定评测领域，既不能改变通用调度，也不能证明外部状态发生了对应变化。
业务报告可以按 Eval ID、tags 或 metadata 定义自己的分组和读数。

## 框架保证与外部状态

NiceEval 保证本轮的执行 lineage：成员完整、顺序确定、单步串行、前序步骤没有被结果沿用替代。
每条序列结果都记录 Sequence ID、定义摘要和步骤位置，报告不需要解析数字文件名前缀。

NiceEval 不检查 opaque 外部状态的内容。
`$HOME` 目录、远端 memory 服务或共享数据库是否从干净起点开始，仍由 Experiment 的 Sandbox lifecycle 与外部系统负责。
多个 Invocation 共用一份状态时继续使用 `sharedState.key` 独占完整窗口。

Sequence 开始时若无法证明外部状态已回到约定起点，作者必须换新 cohort 或由 lifecycle 恢复固定 revision。
CLI 只报告能观察到的 state key、Sequence lineage 与实际派发，不把“执行了完整前缀”夸大成“外部状态已经干净”。

## 终态传播

`passed` 与 `failed` 都是已完成步骤。
它们封口并完成收尾后，Runner 才派发下一步；领域判分失败不会抹去已经发生的交互。

`errored`、`skipped` 或 Invocation 中断不能证明步骤到达可继续的提交边界。
Runner 不派发其后的步骤，并把未开始成员记录为 `skipped`，诊断码为 `sequence-history-incomplete`。
下一次运行仍从第一步真实重放，不从中断位置继续。

## 范围

包含：

- `defineSequence()` 与 `sequences/` 文件发现；
- 一个 Sequence 对现有 Eval ID 的有序引用；
- `niceeval exp --sequence` 与 `--through` 的完整前缀重放；
- Sequence Invocation 内固定为单步串行，并禁用结果沿用；
- Sequence lineage 的计划输出、Record 字段与报告读取面；
- 缺成员、重复成员、非法收窄和历史中断的结构化反馈。

不包含：

- `role` 或 memory 领域的 learn、update、revoke、checkpoint 词表；
- 解析文件名中的数字前缀、目录名或 metadata 来推断依赖；
- 自动判断某条业务记忆是否新增、替换、撤销或存活；
- 自动清空作者的外部服务、创建 cohort 或验证 checkpoint 内容；
- 分支图、条件步骤、循环和 DAG；
- 从已保存的中间 checkpoint 恢复，或只从序列中段开始；
- 把 checkpoint survival 固化成 NiceEval 通用读数。

## 入口

- [Library](library.md) —— `defineSequence()`、发现路径与定义形状
- [CLI](cli.md) —— 选择、计划、完整前缀重放与错误反馈
- [Architecture](architecture.md) —— Sequence、Run、Attempt 的关系及 lineage 不变量
- [Use Case](use-case/README.md) —— 按用户目标组织的完整路径
