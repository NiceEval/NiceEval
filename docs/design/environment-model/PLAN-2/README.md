# PLAN-2:单 template 与统一 Layer(不推荐)

**相关文档**：[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 方案摘要

每条 Attempt 只读取一个 provider 原生 template，再把 Experiment、Eval 和 Agent 需要安装的内容统一成 Layer。
template 可以是 image、E2B template、snapshot，或候选模型试图从 Compose 归一出的起点；Layer 负责把这个起点补到目标状态。

这个方案刻意追求两个“一”：

- 一个 template 槽位。Eval 与 Experiment 不能各自贡献一份需要运行时合并的起点。
- 一个 Layer 协议。普通工具、Eval 附加内容和 Adapter 内部的 Agent CLI 安装都进入同一个并行池。

公开调用只见 [Library](library.md)。
template 读取、Layer 执行、身份和失败语义只见 [Architecture](architecture.md)。
[Lifecycle](lifecycle.md)按 owner 展开单 template 选择、build / start / install / Fixture 以及 fresh / reuse 的执行频次。

## 核心取舍

统一 Layer 把“安装某项内容”的最小形状压到 `identity + install`。
框架用受管 manifest 处理默认检查；真实状态无法由 manifest 代表时，作者可提供 `inspect`。

代价是协议只能保留各安装领域的交集：

- Agent 的 staged payload、目标平台探测、安装模式和逐 Attempt 安装事实没有对应位置。
- Layer 没有依赖与资源声明，所有 miss 默认并行；存在顺序或共享资源时，作者只能把内容合成一个 Layer。
- 受管 manifest 证明的是曾经安装，不能证明当前二进制、PATH、权限和动态库仍然正确。
- 单 template 不能完整表示 Compose 的多 service、网络、ready、能力句柄、证据和整组回收。

因此本方案的简洁来自删除领域义务，而不是在更小的模型里完整兑现它们。

## Base 与收敛规则

Eval environment、Experiment 单 template 和按 profile 的 `templates` 表竞争同一个 Base 槽位。
同一 Attempt 不会合并两份 Base；双声明没有表项消解时，在启动期报冲突。

选定 template 后，全部 Layer 进入同一执行池。
默认检查读取受管 manifest，自定义 `inspect` 才读取实际状态；未命中的 Layer 并行执行 `install`。
本方案没有宿主侧 `prepare`、依赖 DAG、资源互斥或安装后的全组真实复检。

## 守护判断

[十个 Case 的逐项矩阵](use-case/README.md)显示：

- C6 可以继续使用既有 Sandbox 状态 Hook,不需要把状态伪装成 Layer,但 Hook 后没有三方真实最终屏障。
- C1 到 C9 都只能涵盖部分路径。
- C10 的普通默认起点会与自带 environment 的 Eval 形成双 template 冲突，不能满足验收条件。

## 对照 GOALS

| 需求 | 判断 | 原因 |
|---|---|---|
| 1 三份要求同时满足 | 部分 | 三类安装可以进同一池，但 Agent 专有义务被丢失 |
| 2 双方可带 Base 或 Ensure | 部分 | 双方可贡献 template 或 Layer，但 Requirement 与兑现方式没有分开 |
| 3 双 Base 显式融合 | 部分 | 双声明报错，`templates` 可替换起点，但不分别验证两份要求 |
| 4 按 profile 提供融合 case | 部分 | map 能按 profile 查表，值却不是完整 `Sandbox Case` |
| 5 单 Base 下收敛或判不兼容 | 不满足 | miss 只有 `install`，没有“无法安装但可验证”的不兼容分支 |
| 6 运行事实验证 | 不满足 | 默认 manifest 命中即跳过，只有自定义 `inspect` 才读取现场 |
| 7 自动安全调度 | 不满足 | 未命中项全并行，依赖和资源冲突只能靠合并 Layer |
| 8 身份正确落盘 | 部分 | 声明身份可哈希，读取身份、实际事实和活动没有完整形状 |
| 9 普通起点不制造冲突 | 不满足 | Experiment 单 template 与 Eval environment 双声明即冲突 |

## 与其它方案的关系

- PLAN-1 按 Environment 与 Provision 分工，并保留有序安装；本方案把出处差异和顺序一并消去。
- PLAN-3 恢复完整 `Sandbox Case`，并把普通 Addon 与 AgentProvisioner 分开；这是本方案没有保住的两类领域义务。
- PLAN-4 与 PLAN-11 先建模 Requirement，再区分 Base Case 与 Ensure；本方案只按声明来自哪一侧分配同一个槽位。
