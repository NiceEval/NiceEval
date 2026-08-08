# PLAN-11 用例范围

契约单源始终在[方案](../README.md)、[Library](../library.md)、[Architecture](../architecture.md)与[Lifecycle](../lifecycle.md)。
本目录只把根 [CASES](../../CASES.md) 的输入逐项代入推荐方案,不复制类型定义。

## 涵盖矩阵

| Case | 状态 | 声明与运行路径 | 用户会看到什么 |
|---|---|---|---|
| [C1 评估 Sandbox 较重](../../CASES.md#c1评估-sandbox-较重) | 涵盖 | `composeSandbox()` 贡献 Eval Requirement 集合与完整 Compose Base | 每个构建输出按自己的 BuildKey 复用;不同 CaseKey 不共用实例 |
| [C2 实验 Sandbox 较重](../../CASES.md#c2实验-sandbox-较重) | 涵盖 | Experiment contribution 携带工具、运行时、证书或模型成员 | 每个全新 Sandbox 逐成员 verify;身份变化后只补齐未命中成员 |
| [C3 双方 Sandbox 都较重](../../CASES.md#c3评估与实验-sandbox-都较重) | 涵盖 | Eval Base 被选中,Experiment Requirement 集合在其中 Ensure | 离线 payload 按 owner、name、identity 与平台 single-flight;准备、上传、安装与复检分别归因 |
| [C4 组合多个条件](../../CASES.md#c4组合多个条件) | 涵盖 | 证书、registry、运行时与工具各自是成员,依赖和资源进入统一图 | 未知资源保守串行;安全成员并行;全组屏障发现后装破坏 |
| [C5 预装稳定条件](../../CASES.md#c5预装稳定条件) | 涵盖 | 默认 case、条件基底或融合 case 都只提供检查命中机会 | 预装命中时零 install;漂移时补齐或在 Agent 前判不兼容 |
| [C6 新 Sandbox 载入外部状态](../../CASES.md#c6新-sandbox-载入外部状态) | 涵盖 | 独立 state lifecycle 每 Sandbox load/save,不借用 SandboxSpec Hook | 每 Attempt 新建 Case;Eval、Experiment 与 AgentProvisioner 条件收敛后 load,收尾 save |
| [C7 复用 Sandbox 活状态](../../CASES.md#c7复用-sandbox-活状态) | 涵盖 | `sandboxReuse` 管理复用周期,三方检查仍逐 Attempt执行 | BuildKey 按 Run 复用;复用周期 locate/start/load/save,Attempt reset/Ensure |
| [C8 Experiment template 主导起点](../../CASES.md#c8experiment-template-主导起点) | 涵盖 | `environment.base` 与实验 Requirement 集合同点声明 | 条件基底创建 Sandbox;Eval 成员 verify 命中或现场 Ensure |
| [C9 Eval template 需要融合条件](../../CASES.md#c9eval-template-需要融合条件) | 涵盖 | 精确 profile 的融合 `cases` 表消解 Eval Base 与条件基底 | 缺项在创建 Sandbox 前一次报全;启动后逐成员验证双方条件 |
| [C10 混合批次](../../CASES.md#c10混合批次) | 涵盖 | 默认 case 不参与冲突;只有条件基底与 Eval Base 同时存在才查融合表 | 有题目 Base 的 Eval 使用自身或融合 case,其余使用条件基底或默认 case |

## 代表性用例

- [Experiment 条件基底](Experiment条件基底.md) —— C8 从实验条件预制 Sandbox 启动,再收敛 Eval Requirement。
- [融合双方基底](融合双方基底.md) —— C9 为不同 environment profile 选择完整融合 case。
- [混合批次](混合批次.md) —— C10 同时展示普通默认 case 与可选条件基底的固定优先级。

## C1 到 C7 的关键观察

- C1 到 C3 不要求手工维护题目 × 实验的预制组合矩阵。
  只有双方明确贡献不可叠加 Base 时,才由 C9 的融合表承担组合成本。
- C4 的 Requirement 成员保持独立身份和错误归属。
  数组位置不表达顺序,调度只读取依赖与资源。
- C5 的预装优化不改变检查协议。
   起点构建输出名和 manifest 都不能代替实际 identity 与 facts。
- C6 与 C7 都让状态留在 ExperimentStateLifecycle。
   前者每条 Attempt 使用全新 Sandbox,后者让活状态跨 Attempt 留在同一复用周期。

## 共同运行底线

所有十个 Case 都经过同一条最终路径:

1. 收集 Eval、Experiment 与 Agent 三方声明,选择唯一 Base Case。
2. 按全部 BuildKey build/locate,创建完整 Case,等待 ready 并执行早期 SandboxSpec setup。
3. 收敛 Eval 与 Experiment 成员并建立 baseline,再由 AgentProvisioner Ensure CLI。
4. 独立 state lifecycle 按 fresh Attempt 或 reuse window cadence load。
5. 重建 turn 前 Fixture,执行并验证 Agent runtime,再运行三方最终屏障。
6. 最后一次 Agent turn 后才通过受管 Fixture 挂载隐藏 verifier;断言求值后先移除隐藏材料,再按 fresh/reuse 顺序执行 runtime、state、Eval 与 Sandbox 收尾。
