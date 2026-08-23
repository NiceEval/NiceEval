# Sandbox Cache

本方向定义 Sandbox 起点怎样按内容构建，以及由 NiceEval 创建的 provider cache 怎样被盘点、归因和安全回收。

## 子方向

- [Docker Image](docker-image/README.md) —— 用统一 `dockerImage()` 声明预制镜像或按内容构建的镜像。
- [Setup 前缀缓存](setup-prefix/README.md) —— 同一条 setup 链按依赖和变化频率分层，只重新执行变化节点及其后缀的 steps。
- [Provider Cache 生命周期](cache-lifecycle/README.md) —— 管理 Provider cache 的需求、库存、lease、归因与删除不变量。

镜像声明拥有静态构建输入，可缓存 setup 拥有必须在运行中 Provider ready 后完成的确定性准备，cache 生命周期拥有跨运行的物理复用。三者共享内容 identity，但不把“每个逻辑前缀可缓存”误写成“每个前缀一定持久发布”。
