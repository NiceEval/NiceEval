# Environment 与 Provision 用例手册

先判断变化来自 Eval 还是 Experiment,再进入对应场景。
契约单源始终在 [README](../README.md)、[Library](../library.md) 与 [Architecture](../architecture.md);用例只展示完整搭配。

## 三种项目形态

| 项目形态 | 主要声明 | 完整用例 |
| --- | --- | --- |
| 实验环境较重:工具随 Experiment 变化 | `experiment.provisions` | [实验环境较重](实验环境较重.md) |
| 评估环境较重:每道 Eval 自带 Dockerfile 或 Compose | `eval.environment` | [评估环境较重](评估环境较重.md) |
| 两边都较重:每题环境 × 每实验工具 | 同时声明 Environment 与 Provision | [实验与评估环境都较重](实验与评估环境都较重.md) |

三条路径都不要求 `materializers`、`dockerComposeMaterializer()`、Layer 或手工组合 template。

## 高级用法

| 额外目标 | 完整用例 |
| --- | --- |
| 多个 Provision 有明确安装顺序 | [组合多个预置项](组合多个预置项.md) |
| 现场安装稳定但太慢 | [把预置项装进预制环境](把预置项装进预制环境.md) |
| 实验要观察跨 Attempt 累积状态 | [复用 Sandbox 中的状态](复用沙箱中的状态.md) |

Provision 安装慢不自动推出 `sandboxReuse`。
默认保持 Attempt 隔离;下载由 prepare single-flight,稳定安装进入预制环境,只有实验接受跨 Attempt 状态时才复用 Sandbox。
