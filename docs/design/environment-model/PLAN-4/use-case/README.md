# PLAN-4 用例守护

契约单源始终在[方案](../README.md)、[Library](../library.md)与[Architecture](../architecture.md)。
本目录只把根 [CASES](../../CASES.md) 的输入逐项代入方案 4,不重新定义共同验收条件。

## 守护矩阵

| Case | 状态 | 声明与运行路径 | 用户会看到什么 |
|---|---|---|---|
| [C1 评估 Sandbox 较重](../../CASES.md#c1评估-sandbox-较重) | 涵盖 | `composeSandbox()` 同时贡献 Eval Requirement 与完整 Compose Base | Compose 构建按 BuildKey 复用;每条 Attempt 使用独立 CaseKey 与运行实例 |
| [C2 实验 Sandbox 较重](../../CASES.md#c2实验-sandbox-较重) | 涵盖 | Experiment contribution 只带 Requirement,Provider 中性 case 作为起点 | 每个新 Sandbox 先 verify;身份变化后现场 prepare、install、recheck |
| [C3 双方 Sandbox 都较重](../../CASES.md#c3评估与实验-sandbox-都较重) | 涵盖 | Eval Base 被选中,Experiment Requirement 在其中 Ensure | 离线 payload 按 owner、name、identity 与平台 single-flight;上传和安装分别记 activity |
| [C4 组合多个条件](../../CASES.md#c4组合多个条件) | 部分涵盖 | 多项条件压成一个复合 Experiment Requirement | 可以保守串行并最终全组验证,但成员身份、依赖、资源与错误被复合对象合并 |
| [C5 预装稳定条件](../../CASES.md#c5预装稳定条件) | 涵盖 | Base 预期满足 Requirement,启动后仍执行 verify | 检查命中时零安装;状态漂移时现场补齐或给出不兼容 |
| [C6 新 Sandbox 载入外部状态](../../CASES.md#c6新-sandbox-载入外部状态) | 部分涵盖 | 目标 load/save 位于安装条件之后 | 没有独立晚期 state API,现有 SandboxSpec Hook 相位更早 |
| [C7 复用 Sandbox 活状态](../../CASES.md#c7复用-sandbox-活状态) | 部分涵盖 | `sandboxReuse` 管理复用周期,Requirement 不承载状态 | state identity、activity、轮换与失败语义未闭合 |
| [C8 Experiment 提供条件基底](../../CASES.md#c8experiment-提供条件基底) | 涵盖 | SandboxSpec 显式起点或 `environment.base` 成为 Experiment Base | Eval verify 命中即继续;可安装时补齐,否则在 Agent 前判不兼容 |
| [C9 双方都有不可叠加基底](../../CASES.md#c9双方都有不可叠加基底) | 涵盖 | 精确 profile 的 `cases` 表提供完整融合 case | 缺失 profile 在创建 Sandbox 前一次报全;启动后分别验证双方 Requirement |
| [C10 混合批次](../../CASES.md#c10混合批次) | **不涵盖** | SandboxSpec 显式起点对所有 Eval 都算 Experiment Base | 自带 Compose 的 Eval 被判双 Base,即使该起点只是普通默认值也必须提供融合 case |

## 代表性用例

- [Experiment 提供起点](实验起点.md) —— C8 从 Experiment Base 启动,再验证或补齐 Eval Requirement。
- [融合双方基底](融合双方基底.md) —— C9 用精确 profile 表消解两个不可叠加 Base。
- [混合批次缺口](混合批次缺口.md) —— C10 展示普通起点为什么被误判成 Experiment Base。

## C1 到 C7 的关键观察

- C1 到 C3 不生成 Eval × Experiment 的预制组合矩阵。
  只有 C9 明确选择融合 case 时,组合成本才由作者承担。
- C4 的复合 Requirement 能保证最终正确性,但失去成员级组合能力。
  这是方案 5 把 contribution 改成 Requirement 集合的直接动因。
- C5 的预装命中不改变 verify 路径。
  受管 manifest 只能作为检查 cache,不能作为状态证明。
- C6 与 C7 都不把实验状态并入 Requirement。
  区别只在每条 Attempt 使用全新 Sandbox,还是多个 Attempt 共享一个复用周期。
