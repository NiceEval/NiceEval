# Coding Agent 的嵌套 Docker Sandbox

> 观察日期：2026-08-25
>
> 观察对象：Docker Sandboxes、Runloop Devbox、Incus、Sysbox、Firecracker、Docker Registry 与 BuildKit
>
> 文档性质：外部产品研究与设计输入，不是 NiceEval 目标契约

## 研究问题

Coding Agent 经常要在评估 Sandbox 内执行 `docker build`、`docker run` 与
`docker compose`。真正的问题不是让 `dockerd` 启动一次，而是同时满足：

- 每条 Attempt 只控制自己的 Docker daemon；
- Agent 看不到宿主 Docker socket，也不能跨 Attempt 操作资源；
- 四条 Attempt 可以并发，各自取得有界的 Docker data 容量；
- setup、image pull 与 build 能复用，但私有容器、volume、secret 与 workspace 不能复用；
- CLI 被 `SIGKILL`、宿主重启或 Provider 中断后，系统仍能证明谁拥有实例和存储；
- 任一优化失效时 fail closed，不回退到宿主 daemon 或共享 writable state。

此前的[容器进程模型研究](../docker-sandbox-process-models.md)回答框架怎样保持
Sandbox 存活并执行命令。本文继续追问更外层的问题：当 Sandbox 自己还要提供 Docker 时，
谁拥有 VM、磁盘、mount、daemon、快照和回收。

## 研究方法

先把产品宣传拆成五项可核对能力，再阅读一手材料：

1. 隔离边界是共享宿主内核、专用 guest kernel，还是宿主 socket。
2. Docker daemon 和 `/var/lib/docker` 是否逐 Sandbox 独占。
3. 产品能否从不可变起点并发克隆私有实例。
4. 谁保存 durable instance identity，谁在 owner 消失后回收。
5. 缓存保存的是可信 Provider 构建输出，还是上一条 Attempt 的整份可变状态。

没有文档证明的能力标为“待 PoC”，不从“完整 Linux”“支持 Docker”或“支持 snapshot”
反推出评估所需的隔离与恢复语义。

## 研究判断

专用 kernel Sandbox 已经是成熟的产品类别。NiceEval 不需要自己继续经营 raw DinD 的 mount、
loop device 与 Docker data 生命周期。Docker Sandboxes 证明“coding agent + microVM + 私有 daemon +
专用 block volume”是可用的产品形态。Runloop 证明托管 Devbox 可以把 DinD、Blueprint 与磁盘快照
组合成按 API 分配的 Sandbox 实例。Incus 则提供适合自托管的 VM、存储池、快照、clone、quota 与
实例 inventory。

这些产品不能直接互换。Docker Sandboxes 在 Linux 上只支持 Ubuntu 24.04 及以上，不能作为 NixOS
宿主的直接修复。Runloop 把基础设施和数据交给托管服务。Incus 提供 VM 与存储控制面，
但 NiceEval 仍须实现自己的 capability binding、Attempt lease、fencing 与结果语义。

缓存也不应等同于共享或盲拷贝 `/var/lib/docker`。共享加速优先使用 digest-pinned OCI 内容、
registry mirror 与 BuildKit external cache。只有确定性 setup 才能由受信任 publisher 在 daemon
完全静默后捕获为 Provider artifact，再由 Provider 为每条 Attempt 建立私有 clone。

## 正文

- [产品与执行模型](products.md)——自托管 VM、托管 Sandbox、system container 与直接 microVM。
- [缓存与快照边界](cache.md)——哪些内容可以共享，什么时候才允许捕获完整磁盘状态。
- [所有权与恢复](ownership-and-recovery.md)——mount namespace、唯一 owner、fencing 与 orphan 回收。
- [设计决策](../../design/nested-docker-execution/README.md)——把研究事实变成 NiceEval 候选与裁决。
