# OpenSandbox rootfs 准备缓存与失败边界

## 决策

OpenSandbox 的准备缓存复用现有 Persistent before cache；不增加公开参数，不另建控制面。固定 digest 的 Base、服务地址与凭据摘要进入缓存域。捕获对象仅为 rootfs，进程、卷和 tmpfs 不属于快照内容。

## 理由与边界

官方 release-1.1.1 的公开 Snapshot API 支持创建 rootfs 镜像并从 snapshotId 创建实例。Kata 运行环境的镜像提交 Job 需要受限 containerd socket 权限；权限及 registry 凭据归部署方。NiceEval 只调用服务 API，不持有 registry 凭据。

创建快照之后无法凭短暂的命令成功证明源实例不会再次被冻结。故请求发出后任何失败或响应歧义均终结源实例并失败，不重放已经完成的 action。只有创建请求前的敏感内容、挂载和竞争检查可继续 uncached。

UserDatabase 新增相邻 migration 和独立 opensandbox-cache repository，保留旧 provider 数据含义。发布 intent、fencing lease、原子 clone root adoption 与已发布 generation 历史共同防止并发覆盖和使用中删除；未确认释放的 root 不凭时间清除。

## 独立审查

主 agent 先形成 sandbox architecture 与 it-infra snapshot-cache 具体方案，再由 Herdr 原生 Codex / GPT-6.1 Sol 独立审查。已收敛问题：server store.path、clone imagePullSecrets、上游 unpause Job 缺少模板时拒绝并退休源实例；generation 胜者必须按已发布历史判定，publication 与 root adoption 同事务，replacement scope 保留累计 action manifest。

## 已获得证据

真实服务完成 rootfs capture / restore 与资源回收。安装后候选在无模型调用下完成冷缓存、跨 Invocation 恢复、输入变化、bypass、clone 写入隔离和上游快照删除后的 Base 降级。准备步骤标记在命中时相同，在 bypass 与降级时重新生成。

procfs mountinfo 不能走 execd 文件下载：它声明零长度。实现使用原生 argv 的 cat 读取，并只允许初始化时存在的系统挂载；Docker 镜像应导出到 rootfs 归档，停止准备 daemon 并卸载临时 data-root，恢复后再启动独立 daemon 导入。

## 契约

目标契约见 [Sandbox 架构](../docs/feature/sandbox/architecture/remote-snapshot-cache.md#opensandbox)。Snapshot API 删除不等于 registry blobs 回收。部署侧仍需管理 retention 与容量；当前方案不宣称进程或内存快照。
