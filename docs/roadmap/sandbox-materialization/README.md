# Sandbox Materialization

本方向定义 Sandbox 起点怎样按内容构建，以及由 NiceEval 创建的 provider cache 怎样被盘点、归因和安全回收。

## 子方向

- [Docker Image](docker-image/README.md) —— 用统一 `dockerImage()` 声明预制镜像或按内容构建的镜像。
- [Provider Cache 生命周期](cache-lifecycle/README.md) —— 管理 materialization cache 的需求、库存、lease、归因与删除不变量。

镜像声明拥有可复现的构建输入；cache 生命周期拥有跨运行的物理复用。二者共享内容 identity，但不把“声明相同”误写成“物理缓存永久存在”。
