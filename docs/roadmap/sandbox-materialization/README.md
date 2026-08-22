# Sandbox Materialization

本方向定义 Sandbox 起点怎样按内容构建，以及由 NiceEval 创建的 provider cache 怎样被盘点、归因和安全回收。

## 子方向

- [Docker Image](docker-image/README.md) —— 用统一 `dockerImage()` 声明预制镜像或按内容构建的镜像。
- [Sandbox Deployment](deployment/README.md) —— 在 Provider ready 后执行可复现准备，并把干净结果作为内容寻址起点复用。
- [Provider Cache 生命周期](cache-lifecycle/README.md) —— 管理 materialization cache 的需求、库存、lease、归因与删除不变量。

镜像声明拥有静态构建输入，Deployment 拥有必须在运行中 Provider ready 后完成的可复现准备，cache 生命周期拥有跨运行的物理复用。三者共享内容 identity，但不把“声明相同”误写成“物理缓存永久存在”。
