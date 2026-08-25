# Docker 执行配置 —— Architecture

旧 Docker Profile 把 activation、watchdog、loop-backed slot 与 inner dockerd 绑在同一条宿主职责链上。
这不是 nested Docker 的 owner 模型。

adopted 边界见 [Nested Docker Architecture](../nested-docker/architecture.md)：
NiceEval 拥有 ledger 与 capability；Provider 拥有 VM 与存储；guest init 拥有 mount 与普通 dockerd。

## Setup Prefix 支持边界

nested Docker 只对完整、可验证的 prepared Sandbox artifact 报告 coverage。
`sandboxState.dockerData` 不是 public state surface。

旧 Profile 的 seed / slot raw copy、loop-ext4 与 project-quota 不能作为这条 SetupPrefix 资格的 fallback。
普通本地 `dockerSandbox()` 的 exact-image 缓存仍由
[Sandbox Architecture](../architecture.md#docker-支持边界) 定义，且不把 Docker API 交给 Agent。

## 单容器资源

nested Docker 的 Docker data allocation 是 guest 内独立 virtual disk。
容量由 dedicated block-backed attestation 证明，绑定 allocationId 与 generation。

预建目录池、loop device、project quota slot 与 watchdog 状态机不是 adopted nested-Docker public path。
它们不能满足 `dedicated-kernel/v1`，也不能降为 fallback。
