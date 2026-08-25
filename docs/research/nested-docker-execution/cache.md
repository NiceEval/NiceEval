# 缓存与快照边界

> 观察日期：2026-08-25

## 不共享 writable Docker data

一个 Docker daemon 的 `/var/lib/docker` 同时包含 image metadata、container runtime state、
volume、BuildKit state、snapshotter 数据与 daemon 自身数据库。它不是只读 layer store。
Sysbox 的[官方 DinD 指南](https://github.com/nestybox/sysbox/blob/master/docs/quickstart/dind.md)
明确要求每个 daemon 使用专用 data store，并把跨 daemon image 加速交给 registry cache。

因此下面三件事必须分开：

- 每条 Attempt 的 writable Docker data disk，始终私有；
- 多条 Attempt 可读取的 OCI blob 与 BuildKit cache，由受信任服务保存；
- 确定性 setup 的完整磁盘结果，由 Provider 以不可变 artifact 发布后再 clone。

把一份活动中的 `/var/lib/docker` 复制给下一条 Attempt，会把 daemon 内部一致性和用户隐私同时
变成复制脚本的隐含责任。让多个 daemon 挂同一份 writable data 则直接违反 Docker 的所有权边界。

## 三层缓存

| 层 | 内容 | 写入 owner | Attempt 如何消费 | 隔离要求 |
|---|---|---|---|---|
| OCI catalog / mirror | digest-pinned runtime image 与 pull-through blob | 受信任发布流程 | 每个 daemon 只读 pull | 凭据和私有仓库按 trust domain 分开 |
| BuildKit external cache | 内容寻址 build result | 受信任 publisher；普通 Attempt 只写私有 namespace | `--cache-from` 导入 | 不把未审查 Attempt 输出提升为共享输入 |
| Provider artifact | guest root、工具与确定性 SetupPrefix 的 provider-native snapshot | 专用 prepare worker | clone 成私有 VM 与磁盘 | artifact immutable，每个 consumer 独立 writable |

Docker 的[registry mirror 文档](https://docs.docker.com/docker-hub/image-library/mirror/)
把多 daemon 的重复 pull 作为标准场景。mirror 第一次从上游拉取，之后从本地存储提供相同内容。
对于有限且固定的 runtime 集合，直接把 digest-pinned image 发布到受控 registry 比透明 mirror 更明确。

BuildKit 的[external cache 文档](https://docs.docker.com/build/cache/backends/)支持 `registry`、
`local` 等 exporter，并通过 `--cache-to` 与 `--cache-from` 显式写入和读取。文档也警告同一 cache
多个 writer 不能随意替换同一 location 的已有内容。NiceEval 因而需要 trusted/shared 与 invocation-private
namespace，不能让不可信 Attempt 共同写一个 tag。

## Provider artifact 不是第二个 Sandbox template

NiceEval 已用 `SandboxTemplate` 表示作者选择 Provider 和完整 Sandbox origin 的声明，
用 `SetupPrefix` 表示确定性 before action 的内容前缀。新执行模型不创建同名概念。

Provider 在 exact SetupPrefix 上捕获的 VM image、volume snapshot 或远端 snapshot ID 都叫
`Provider artifact`。其 identity 至少包含：

- Sandbox template identity、SetupPrefixKey 与 Provider protocol revision；
- guest image digest、kernel/architecture 与 Docker/Compose version；
- Docker data virtual disk 的逻辑容量和 filesystem identity；
- OCI catalog、BuildKit cache 与准备步骤的非敏感输入 identity；
- capture、quiesce、sanitize 与 clone protocol revision。

artifact locator、物理 snapshot 名与后端 pool 名不进入 Eval 语义。Provider 必须双向验证 manifest
与实际对象，不能仅凭命名约定报告命中。

## 允许捕获的静默点

完整磁盘 snapshot 只允许由受信任 prepare worker 产生。capture 前依次证明：

1. 没有 Agent、Eval test、secret overlay 或外部 lease 进入 guest。
2. 没有运行中的 inner container、Compose project 或 BuildKit session。
3. `dockerd`、`containerd` 与相关 shim 已停止，guest 完成 `sync`。
4. Docker data volume 已从 guest 卸载，或整个 VM 已由 Provider 可靠关机。
5. Provider snapshot 完成后，原对象保持 immutable；每个 consumer 从它建立私有 clone。
6. 新 clone 启动后重新生成 instance identity、network identity 和 transient socket，再做 `docker info`。

只暂停 VMM vCPU 不足以证明文件系统一致。Firecracker 的 snapshot 文档也把 block device 文件和
持久化管理留给调用者；上层必须先建立 guest 与磁盘的 quiesce 协议。

## 4 GiB 的含义

每条 Attempt 的 Docker data volume 逻辑 hard limit 是 4 GiB。CoW clone 可以共享 immutable
baseline block，但 capacity admission 必须为四条并发 Attempt 预留 16 GiB writable budget，
再加 artifact、metadata 与 emergency cleanup reserve。thin pool 的“可以 overcommit”不是容量证明。

达到单 allocation hard limit 时只让该 Attempt 失败。pool 可写容量低于安全阈值时可以停止新 admission，
但不能因为一个损坏 artifact 或一条满盘 Attempt 永久 quarantine 全部健康 allocation。
