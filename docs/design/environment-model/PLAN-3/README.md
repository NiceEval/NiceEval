# PLAN-3:完整 Sandbox Case 与 Experiment Addon(不推荐)

**相关文档**：[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md) · [Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [DECISION](../DECISION.md)

## 方案摘要

本方案保留三个公开领域对象，各自回答一个问题：

| 对象 | 职责 | 声明方 |
|---|---|---|
| Sandbox Case | 题目从什么完整运行环境开始 | Eval environment 与当前 SandboxSpec |
| Addon | Experiment 希望在主 Sandbox 中成立的普通工具状态 | Experiment |
| AgentProvisioner | Adapter 启动 Agent 所需的身份、准备、检查与安装 | Adapter |

Addon 与 AgentProvisioner 可以复用宿主侧准备协调、依赖图和安装资源互斥设施，但不共用同一个公开协议。
Agent 的 staged payload、安装模式、启动条件和逐 Attempt 安装事实因此不会被压缩成普通 Addon 的最小交集。

公开调用只见 [Library](library.md)。
Case 解析、Addon 调度、生命周期、身份和错误只见 [Architecture](architecture.md)。
从 Base build 到 fresh/reuse Attempt 的完整频次见 [Lifecycle](lifecycle.md)。

## Base 与收敛规则

Sandbox Case 是唯一 Base。
Eval 的 folder-local source、profile 映射或 Provider 默认起点解析成一份完整 Case；`environments` 表项可以用预制 Case 替换同 profile 的现场 materialize。

Experiment 不提供 Base，只提供 Addon。
每个 Addon 先检查实际状态，miss 后才准备 payload 和安装，安装后复检。
全部安装结束后再验证整组，AgentProvisioner Ensure 完成后还有一次跨 owner 验证屏障。

这个不对称模型覆盖“Eval 提供题目 Base，Experiment 和 Agent 在其上收敛”的主路径。
它没有 Experiment 条件基底、可移植 Eval Addon 或双基底融合 Case，因此不是完整的双向模型。

## 为什么保留三个对象

- Sandbox Case 已经承载主 Sandbox、伴随资源、ready、能力、证据、身份、错误、清理与留存。
- Addon 面向普通实验工具，最小义务是目标身份、真实检查、安装和复检。
- AgentProvisioner 还要处理平台探测、题面外 staged payload、安装模式与 Agent 专有事实。

三者共享调度原语，不等于三者拥有同一领域身份。
这使普通工具保持低成本，同时避免为了统一名字删除 Compose 与 Agent 的既有义务。

## 覆盖结论

[十个 Case 的逐项矩阵](use-case/README.md)显示：

- C1、C2、C3、C4、C5、C7 有完整表达。
- C6 可以保持新 Sandbox 与状态临界区，但状态 Hook 仍早于 Agent Ensure，不满足根 Case 规定的精确时序。
- C8、C9 缺少 Experiment Base、Eval 收敛项与融合 Case，无法表达。
- C10 的普通默认起点与 Eval Base 可以共存，但条件基底分支不存在。

## 对照 GOALS

| 需求 | 结论 | 原因 |
|---|---|---|
| 1 三份要求同时满足 | 支持主路径 | Eval Case、Experiment Addon、AgentProvisioner 分别兑现 |
| 2 双方可带 Base 或 Ensure | 不满足 | Eval 固定提供 Case，Experiment 固定提供 Addon |
| 3 双 Base 显式融合 | 不满足 | Experiment 没有 Base，也没有融合 Case |
| 4 按 profile 提供融合 Case | 不满足 | `environments` 只替换 Eval Case，不表示双方融合 |
| 5 单 Base 下收敛或判不兼容 | 部分 | Experiment Addon 可收敛；Eval 没有独立收敛入口 |
| 6 运行事实验证 | 满足 | Addon 与 Agent 都实际检查、安装后复检，并经过最终屏障 |
| 7 自动安全调度 | 满足 | 显式依赖、资源互斥、未知项保守串行 |
| 8 身份正确落盘 | 满足 | Case、Addon、Agent 声明身份和逐目标解析身份分层记录 |
| 9 普通起点不制造冲突 | 满足 | Provider 默认起点在 Eval Case 存在时让位 |

## 优势

- 完整保留 Compose、多构建产物、主执行空间、伴随服务与整组清理。
- 添加普通实验工具只需一个 Addon，常见场景可以由 helper 消除检查样板。
- 真实检查是默认契约，预装产物和复用 Sandbox 都不能靠名字或 manifest 跳过验证。
- 用户不维护数组顺序；安全节点自动并行，未知写入面保守串行。
- Agent 保留独立 Ensure 义务，同时复用相同资源调度设施。

## 代价

- 公开心智保留 Sandbox Case、Addon 与 AgentProvisioner 三个概念。
- 自定义 Addon 必须实现真实 `check`；helper 只能覆盖常见工具。
- 资源名是开放词表，声明过粗会损失并行，声明错误会带来竞态风险。
- 模型按来源固定角色，无法表达 Experiment 条件基底和可迁移 Eval Requirement。

## 与其它方案的关系

- PLAN-2 把三者压成单 template 与统一 Layer；本方案恢复被压掉的 Case 与 Agent 义务。
- PLAN-4 把 Eval 与 Experiment 都提升成 Requirement、Base Case 与 Ensure；本方案是其中“Eval 总有 Base、Experiment 总是 Ensure”的子集。
- PLAN-5 再区分普通默认起点与条件基底；本方案只拥有普通默认起点和 Eval Case。
