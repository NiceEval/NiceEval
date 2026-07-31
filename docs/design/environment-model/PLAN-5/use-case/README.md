# PLAN-5 用例覆盖

契约单源始终在[方案](../README.md)、[Library](../library.md)与[Architecture](../architecture.md)。
本目录只把根 [CASES](../../CASES.md) 的输入逐项代入推荐方案,不复制类型定义。

## 覆盖矩阵

| Case | 状态 | 声明与运行路径 | 用户会看到什么 |
|---|---|---|---|
| [C1 评估环境较重](../../CASES.md#c1评估环境较重) | 覆盖 | `composeSandbox()` 贡献 Eval Requirement 集合与完整 Compose Base | 构建按 BuildKey 复用;不同 CaseKey 不共用运行实例 |
| [C2 实验环境较重](../../CASES.md#c2实验环境较重) | 覆盖 | Experiment contribution 携带工具、运行时、证书或模型成员 | 每个全新 Sandbox 逐成员 verify;身份变化后只补齐未命中成员 |
| [C3 双方环境都较重](../../CASES.md#c3评估与实验环境都较重) | 覆盖 | Eval Base 被选中,Experiment Requirement 集合在其中 Ensure | 离线 payload 按 owner、name、identity 与平台 single-flight;准备、上传、安装与复检分别归因 |
| [C4 组合多个条件](../../CASES.md#c4组合多个条件) | 覆盖 | 证书、registry、运行时与工具各自是成员,依赖和资源进入统一图 | 未知资源保守串行;安全成员并行;全组屏障发现后装破坏 |
| [C5 预装稳定条件](../../CASES.md#c5预装稳定条件) | 覆盖 | 默认 case、条件基底或融合 case 都只提供检查命中机会 | 预装命中时零 install;漂移时补齐或在 Agent 前判不兼容 |
| [C6 新 Sandbox 载入外部状态](../../CASES.md#c6新-sandbox-载入外部状态) | 覆盖 | 状态使用独立 load/save Hook,不进入 Requirement 集合 | load 位于三种安装条件就位后;临界区和状态保存诊断独立 |
| [C7 复用 Sandbox 活状态](../../CASES.md#c7复用-sandbox-活状态) | 覆盖 | `sandboxReuse` 管理窗口,每条 Attempt 仍跑全部成员检查 | 记录 window identity、序号、资源代次和每条 Attempt 的最终屏障 |
| [C8 Experiment 提供条件基底](../../CASES.md#c8experiment-提供条件基底) | 覆盖 | `environment.base` 与实验 Requirement 集合同点声明 | 条件基底创建 Sandbox;Eval 成员 verify 命中或现场 Ensure |
| [C9 双方都有不可叠加基底](../../CASES.md#c9双方都有不可叠加基底) | 覆盖 | 精确 profile 的融合 `cases` 表消解 Eval Base 与条件基底 | 缺项在创建 Sandbox 前一次报全;启动后逐成员验证双方条件 |
| [C10 混合批次](../../CASES.md#c10混合批次) | 覆盖 | 默认 case 不参与冲突;只有条件基底与 Eval Base 同时存在才查融合表 | 有题目 Base 的 Eval 使用自身或融合 case,其余使用条件基底或默认 case |

## 代表性用例

- [Experiment 条件基底](Experiment条件基底.md) —— C8 从实验条件预制环境启动,再收敛 Eval Requirement。
- [融合双方基底](融合双方基底.md) —— C9 为不同 environment profile 选择完整融合 case。
- [混合批次](混合批次.md) —— C10 同时展示普通默认 case 与可选条件基底的固定优先级。

## C1 到 C7 的关键观察

- C1 到 C3 不要求手工维护题目 × 实验的预制组合矩阵。
  只有双方明确贡献不可叠加 Base 时,才由 C9 的融合表承担组合成本。
- C4 的 Requirement 成员保持独立身份和错误归属。
  数组位置不表达顺序,调度只读取依赖与资源。
- C5 的预装优化不改变检查协议。
  起点产物名和 manifest 都不能代替实际 identity 与 facts。
- C6 与 C7 都让状态留在独立 Hook。
  前者每条 Attempt 使用全新 Sandbox,后者让活状态跨 Attempt 留在同一复用窗口。

## 共同运行底线

所有十个 Case 都经过同一条最终路径:

1. 选择唯一 Base Case 并等待完整 Sandbox Case ready。
2. 验证 Eval 与 Experiment 的每个 Requirement 成员。
3. 只为未命中成员检查安装能力,再 prepare、install 与 recheck。
4. 全组验证 Eval 与 Experiment。
5. AgentProvisioner 完成自己的 Ensure。
6. 外部状态载入后验证三种所有者,通过后才开始 Agent turn。
