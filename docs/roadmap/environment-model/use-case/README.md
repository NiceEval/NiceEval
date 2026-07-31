# 环境层用例手册

从你要完成的事进入,不必先理解运行器的全部内部顺序。
契约单源始终在 [README](../README.md) 与 [Library](../library.md),用例只做搭配与叙事,不复制定义。

## 先判断哪一侧重

| 项目形态 | 怎么声明 | 完整用例 |
| --- | --- | --- |
| 实验环境较重:所有题共用基础环境,工具随 Experiment 变化 | `experiment.layers`;需要让多个 Attempt 共用一次 Sandbox 安装时再评估 `sandboxReuse` | [实验环境较重](实验环境较重.md) |
| 评估环境较重:每道 Eval 自带 Dockerfile 或 Compose | `eval.environment`;BuildKey 负责构建复用 | [评估环境较重](评估环境较重.md) |
| 两边都较重:每题环境 × 每实验工具 | 同时使用 `eval.environment` 与 `experiment.layers`;断网时用 staged Layer | [实验与评估环境都较重](实验与评估环境都较重.md) |

`sandboxReuse` 只复用同一解析后 sandbox case 分组里的 Sandbox,不能跨不同 sandbox case 共享实例。
它不是 Layer 的必选项:默认隔离下 Layer 仍提供身份、检查与组合能力,但全新 Sandbox 上缺失的工具仍要重新安装。

## 再处理特殊用法

| 你还需要什么 | 放在哪里 | 完整用例 |
| --- | --- | --- |
| 多个有先后依赖的实验工具 | 有序的 `experiment.layers` | [组合多个环境层](组合多个环境层.md) |
| 跨 Attempt 状态的载入与回存 | Sandbox `setup` / `teardown` Hook | [复用 Sandbox 中的状态](复用沙箱中的状态.md) |
| 已经跑稳、但现场安装太慢的 Layer | provider 原生 image / template / snapshot | [把环境层预装进产物](把环境层预装进产物.md) |

## 最常见的起点

所有题共用一种基础环境时,从[实验环境较重](实验环境较重.md)开始。
每题自带环境时,从[评估环境较重](评估环境较重.md)开始;Experiment 还要安装工具时,再进入[实验与评估环境都较重](实验与评估环境都较重.md)。
Adapter 自带的 Agent 安装、全栈复检、逐层计时与 fingerprint 都由框架处理,不需要在实验文件里重复编排。
