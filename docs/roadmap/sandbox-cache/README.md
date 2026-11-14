# Sandbox Cache

本方向定义 Sandbox 起点怎样按内容构建，以及由 NiceEval 创建的 provider cache 怎样被盘点、归因和安全回收。

## 子方向

- [Docker Image](../sandbox-cache-docker-image/README.md) —— 用统一 `dockerImage()` 声明预制镜像或按内容构建的镜像。
- [Setup 前缀缓存](../sandbox-cache-setup-prefix/README.md) —— 同一条 setup 链按依赖和变化频率分层，只重新执行变化节点及其后缀的 steps。
- [Provider Cache 生命周期](../sandbox-cache-lifecycle/README.md) —— 管理 Provider cache 的需求、库存、lease、归因与删除不变量。

镜像声明拥有静态构建输入，可缓存 setup 拥有必须在运行中 Provider ready 后完成的确定性准备，cache 生命周期管理 Agent artifact 与任务 image 的跨运行物理复用。三者共享内容 identity。Before cache 的发布、替换与回收由[Before cache 契约](../../feature/sandbox/architecture/before-cache.md)负责，本页的通用库存、lease 与 GC 协议不重复定义它；不支持的 Provider 报告 `Unsupported`，仍真实执行 steps，不伪造 cache hit。
