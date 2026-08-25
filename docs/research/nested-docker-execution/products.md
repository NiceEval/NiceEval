# 产品与执行模型

> 观察日期：2026-08-25。产品能力以本页链接的一手文档为准。

## 对照

| 方向 | 隔离边界 | 私有 Docker | 原生复用手段 | 与 NixOS 自托管的关系 | 研究判断 |
|---|---|---|---|---|---|
| Docker Sandboxes | 每个 Sandbox 一台 microVM | 独立 daemon 与 block volume | template、停止后持久 | Linux 支持面限定 Ubuntu 24.04+ | 形态证明，不直接采用 |
| Runloop Devbox | 托管 Devbox 边界，底层细节由服务拥有 | 官方 DinD Blueprint | Blueprint、disk snapshot、fan-out | 不依赖本机发行版，但引入远端信任与费用 | 托管 Provider 首选 PoC |
| Incus VM | 每个 VM 专用 guest kernel | VM 内普通 Docker | image、storage snapshot、CoW clone | 可在 Linux 自托管；NixOS 部署仍需 PoC | 自托管 reference Provider 首选 |
| Sysbox system container | 与宿主共享 kernel | 容器内 daemon | 专用 data volume、registry cache | 仍由宿主管理 nested container runtime | 不满足专用 kernel 终态 |
| 直接 Firecracker/Kata | microVM 或轻量 VM | 由集成层自行提供 | snapshot 或上层 image | 自己承担 guest agent、网络、磁盘与 inventory | 不作为第一版 Sandbox Provider |

## Docker Sandboxes：形态已经成立

Docker 的[架构文档](https://docs.docker.com/ai/sandboxes/architecture/)明确写出每个 Sandbox
都有自己的 Docker daemon、image cache 与包安装；不同 Sandbox 不共享 image 或 layer。
停止和再次启动保留该 Sandbox 的状态，删除才销毁 VM 及其内容。

[Template 文档](https://docs.docker.com/ai/sandboxes/customize/templates/)进一步说明，带
`-docker` 的 template 在 microVM 内以 privileged container 运行 Docker，并把专用 block volume
挂到 `/var/lib/docker`。这正是 NiceEval 需要的安全边界：Agent 拥有 guest 内 daemon 的完整
权限，但没有通往宿主 daemon 的路径。

它不是本机最终依赖。[安装要求](https://docs.docker.com/ai/sandboxes/install/)把 Linux 支持面
限定为 Ubuntu 24.04 及以上，并要求 KVM。NixOS 宿主不能靠“换成 Docker Sandboxes”直接满足
产品验收，但它证明了专用 kernel、私有 daemon 和专用 Docker disk 是合理的用户模型。

## Runloop：可购买的 lifecycle

Runloop 为 Devbox 提供官方
[Docker-in-Docker Blueprint](https://docs.runloop.ai/docs/devboxes/capabilities/docker-in-docker)，
并允许 Agent 在同一 Devbox 内执行 Docker workload。它的
[Blueprint](https://docs.runloop.ai/docs/devboxes/blueprints/overview)把可重复 setup 构建成可复用
起点；[disk snapshot](https://docs.runloop.ai/docs/devboxes/snapshots)可以保存 Devbox 磁盘状态，
再从同一 snapshot fan-out 多台 Devbox。

这三项组合最接近 NiceEval 的目标。Provider API 可以拥有 create、snapshot、clone、destroy 与
inventory，NiceEval 不需要看到宿主 mount tree。仍需 PoC 证明每个 clone 的 inner Docker data
可写隔离、容量限制、实例枚举、强杀后的 detached destroy，以及 snapshot 前 daemon quiesce。
产品文档没有给出这些评估级证明时，不能把“支持 DinD”直接升级为通过。

## Incus VM：自托管 control plane

Incus 同时管理 system container 与 VM。创建命令的
[`--vm` 形态](https://linuxcontainers.org/incus/docs/main/howto/instances_create/)会建立虚拟机，
因此 Docker 在 guest 的普通 systemd 生命周期里运行，不是宿主容器内的 nested daemon。

Incus 的[存储驱动对照](https://linuxcontainers.org/incus/docs/main/reference/storage_drivers/)
显示 Btrfs、LVM 与 ZFS 都支持优化实例创建、snapshot、CoW、instant clone 与 quota。
该文档推荐 ZFS 或 Btrfs，并明确不建议生产使用 loop-backed pool。ZFS 驱动使用 snapshot 与 clone
创建实例和 volume；LVM 驱动可使用 thin pool 与 volume snapshot。

这让 Incus 适合作为 NiceEval 的自托管 reference Provider：Incus daemon 是实例、虚拟磁盘、
storage pool 与 host mount 的唯一 owner；NiceEval 只通过 API 和 durable locator 管理生命周期。
选择 ZFS、LVM-thin 或 Btrfs 是 deployment policy，不进入 Eval 声明。

## Sysbox：比 raw DinD 小的状态空间，但仍共享 kernel

Sysbox 的 [DinD 指南](https://github.com/nestybox/sysbox/blob/master/docs/quickstart/dind.md)
明确要求每个 inner Docker daemon 拥有专用 `/var/lib/docker`，不能让多个 daemon 并发挂同一份
data store。若多个实例要共享 image cache，文档建议使用 registry pull-through cache。

这个边界判断值得吸收，但 system container 仍共享宿主 kernel。它可以作为受控 CI 的实现选择，
不能满足本决策的 `dedicated-kernel/v1` 隔离要求，也不能消除 nested runtime 与宿主 container
runtime 的共同运维面。

## 直接 Firecracker 或 Kata：组件不是完整 Sandbox 产品

Firecracker 的[snapshot 文档](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)
提供 VM memory/state 的保存与恢复，但明确把磁盘文件、网络、snapshot 打包、完整性和生命周期
管理留给集成者。直接采用意味着 NiceEval 还要实现 VMM supervisor、guest agent、TAP/CNI、
磁盘 snapshotter、image 分发和 orphan inventory。

Kata 能把容器放入专用 kernel VM，但它主要是容器 runtime 构件，不替 NiceEval 提供完整的
Attempt ledger、准备 artifact、配额池与 detached recovery。两者可以成为后续 Provider 的底层，
不应成为第一版自建 control plane 的起点。
