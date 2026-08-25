# Nested Docker Sandbox 选型

Coding Agent Eval 需要在 Sandbox 内运行 Docker 与 Docker Compose。这个能力必须同时具备
Attempt 隔离、四路并发、崩溃回收和可验证的 warm 加速，不能挂宿主 Docker socket。

本决策不把“DinD 能启动”当作成功。选型单位是完整 execution domain：Sandbox 实例、Docker
daemon、磁盘、cache、lease、fencing、recovery 与公开验收必须由一套相容的 owner 模型承担。

## 候选

| 候选 | 核心边界 | 入口 |
|---|---|---|
| PLAN-1 | 修补现有 dual-owner fixed-image DinD | [Fixed-image DinD](PLAN-1/README.md) |
| PLAN-2 | 静态 slot 与长期 DinD；watchdog 只分配 | [Static-slot DinD](PLAN-2/README.md) |
| PLAN-3 | 产品直接绑定自托管 Incus VM | [Incus VM Provider](PLAN-3/README.md) |
| PLAN-4 | 产品直接绑定托管 Runloop Devbox | [Hosted Sandbox Provider](PLAN-4/README.md) |
| PLAN-5 | Eval 声明能力，Experiment 选择专用 kernel Provider | [Provider-neutral nested Docker（推荐）](PLAN-5/README.md) |

LVM-thin、Btrfs 与 ZFS 不是另一个 NiceEval 产品模型。它们是 PLAN-3/PLAN-5 自托管 Provider 的
storage policy。直接 Firecracker、Kata 与 Sysbox 的筛选理由见
[产品研究](../../research/nested-docker-execution/products.md)。

## 共同材料

- [Goals](GOALS.md)——不带方案词汇的成功条件。
- [Limits](LIMITS.md)——NixOS、容量、故障模型与既有产品边界。
- [Cases](CASES.md)——所有候选用同一组真实场景验收。
- [Decision](DECISION.md)——对比、最终方向、替换边界和保留/删除清单。
