# PLAN-1 用例手册

**本方案**:[README](../README.md) · [Library](../library.md) · [Architecture](../architecture.md)

契约单源始终在本方案的 [Library](../library.md) 与 [Architecture](../architecture.md)。
本目录只展示完整搭配;场景输入与共同验收条件统一见根 [CASES](../../../CASES.md)。

## C1-C10 守护矩阵

这里的“支持”表示本方案有直接调用路径。
它不抵消表后列出的共同验收缺口。

| Case | 守护 | 本方案的表达与结果 | 完整用例 |
|---|---|---|---|
| C1 评估 Sandbox 较重 | 部分支持 | Eval 声明 Environment,Experiment 只选 Provider;缺跨 owner 最终屏障 | [评估 Sandbox 较重](%E8%AF%84%E4%BC%B0Sandbox%E8%BE%83%E9%87%8D.md) |
| C2 实验 Sandbox 较重 | 部分支持 | SandboxConfig 提供默认起点,Experiment 声明 Provision;缺跨 owner 最终屏障 | [实验 Sandbox 较重](%E5%AE%9E%E9%AA%8CSandbox%E8%BE%83%E9%87%8D.md) |
| C3 两边都较重 | 部分支持 | Eval Environment 提供起点,Provision 通过 staged payload 离线安装;缺最终屏障 | [实验与评估 Sandbox 都较重](%E5%AE%9E%E9%AA%8C%E4%B8%8E%E8%AF%84%E4%BC%B0Sandbox%E9%83%BD%E8%BE%83%E9%87%8D.md) |
| C4 组合多个条件 | 部分支持 | 能发现后装破坏,但作者必须靠数组位置维护顺序,没有依赖 DAG 或资源互斥声明 | [组合多个预置项](%E7%BB%84%E5%90%88%E5%A4%9A%E4%B8%AA%E9%A2%84%E7%BD%AE%E9%A1%B9.md) |
| C5 预装稳定条件 | 部分支持 | 起点输出改变 EnvironmentKey,Provision 仍 inspect;缺跨 owner 最终屏障 | [把预置项装进预构建 Sandbox](%E6%8A%8A%E9%A2%84%E7%BD%AE%E9%A1%B9%E8%A3%85%E8%BF%9B%E9%A2%84%E6%9E%84%E5%BB%BASandbox.md) |
| C6 新 Sandbox 载入外部状态 | 部分支持 | 每条 Attempt 创建新 Sandbox并在安装后 load/save;load 后缺最终屏障 | [新 Sandbox 载入外部状态](%E6%96%B0Sandbox%E8%BD%BD%E5%85%A5%E5%A4%96%E9%83%A8%E7%8A%B6%E6%80%81.md) |
| C7 复用 Sandbox 活状态 | 部分支持 | 同 EnvironmentKey 内复用且逐 Attempt inspect;缺跨 owner 最终屏障 | [复用 Sandbox 中的状态](%E5%A4%8D%E7%94%A8%E6%B2%99%E7%AE%B1%E4%B8%AD%E7%9A%84%E7%8A%B6%E6%80%81.md) |
| C8 Experiment 提供条件基底 | 不支持 | Eval 只能提供 Environment,不能只声明可在 Experiment 起点上收敛的题目条件 | — |
| C9 双方都有不可叠加基底 | 不支持 | `environments` 只替换 Eval Environment,没有两份 Requirement 和融合 case 语义 | — |
| C10 混合批次 | 部分支持 | 普通默认起点会让位于 Eval Environment,但没有与实验条件绑定的条件基底 | — |

## 共同验收缺口

本方案在 Provision 安装后复检整组 Provision,随后才由 Adapter 安装 Agent CLI。
Agent 安装若修改相同 PATH、包管理器或系统目录,Runner 不会再次验证此前通过的 Environment 与 Provision。
因此它没有涵盖根 [CASES](../../../CASES.md) 要求的跨所有者最终验证屏障。

Provision 与 AgentProvisioner 还各自实现 prepare、检查和安装协调。
Agent 仍保留 staged payload、平台探测、安装模式与 Attempt 事实,但两个系统不能共享依赖和资源冲突图。

## 按项目形态进入

| 项目形态 | 主要声明 | 完整用例 |
|---|---|---|
| 实验 Sandbox 较重:工具随 Experiment 变化 | `experiment.provisions` | [实验 Sandbox 较重](%E5%AE%9E%E9%AA%8CSandbox%E8%BE%83%E9%87%8D.md) |
| 评估 Sandbox 较重:每道 Eval 自带 Dockerfile 或 Compose | `eval.environment` | [评估 Sandbox 较重](%E8%AF%84%E4%BC%B0Sandbox%E8%BE%83%E9%87%8D.md) |
| 两边都较重:每题 Sandbox × 每实验工具 | 同时声明 Environment 与 Provision | [实验与评估 Sandbox 都较重](%E5%AE%9E%E9%AA%8C%E4%B8%8E%E8%AF%84%E4%BC%B0Sandbox%E9%83%BD%E8%BE%83%E9%87%8D.md) |

## 高级用法

| 额外目标 | 完整用例 |
|---|---|
| 多个 Provision 有明确安装顺序 | [组合多个预置项](%E7%BB%84%E5%90%88%E5%A4%9A%E4%B8%AA%E9%A2%84%E7%BD%AE%E9%A1%B9.md) |
| 现场安装稳定但太慢 | [把预置项装进预构建 Sandbox](%E6%8A%8A%E9%A2%84%E7%BD%AE%E9%A1%B9%E8%A3%85%E8%BF%9B%E9%A2%84%E6%9E%84%E5%BB%BASandbox.md) |
| 每个新 Sandbox 载入并回存外部状态 | [新 Sandbox 载入外部状态](%E6%96%B0Sandbox%E8%BD%BD%E5%85%A5%E5%A4%96%E9%83%A8%E7%8A%B6%E6%80%81.md) |
| 实验要观察同一 Sandbox 的跨 Attempt 累积状态 | [复用 Sandbox 中的状态](%E5%A4%8D%E7%94%A8%E6%B2%99%E7%AE%B1%E4%B8%AD%E7%9A%84%E7%8A%B6%E6%80%81.md) |

Provision 安装慢不自动推出 `sandboxReuse`。
默认保持 Attempt 隔离;下载由 prepare single-flight,稳定安装进入预构建 Sandbox,只有实验接受跨 Attempt 活状态时才复用 Sandbox。
