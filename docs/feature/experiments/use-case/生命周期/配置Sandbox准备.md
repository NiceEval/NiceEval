# 配置 Sandbox 准备命令

同一批 Eval 共享、但会随 Experiment 改变的沙箱内准备，写在 Experiment `sandbox` layer 的 `prepare()` 命令里。
典型用途是安装实验专用二进制、写协议配置或预热服务。

prepare 每条 Attempt 都执行，在变更分类账锚点之前运行，不属于 Agent 对任务的修改；开启 Sandbox 复用后先 reset，再重放完整命令链。
昂贵动作由命令做真实检查，命中后快速返回。
清理在取得资源后经 `context.onCleanup()` 登记，按全局准备顺序逆序执行。

跨 Attempt 的实际 Sandbox 目录、服务或快照归 layer 的 `setup()` / `teardown()`：创建后恢复、退休前回存；新的 run 也从同一条 `setup()` 边界恢复。需要唯一连续实例时声明 `sandboxReuse: true`，需要固定顺序时再设为串行，选择方式见[并发用例](../并发/)。
安装与检查 Agent CLI 由 Adapter 的 Agent layer 承担，连 Agent 与鉴权属于 `SandboxAgent.setup`，都不放在这里。
命令的声明形状与执行顺序见 [Sandbox Layer](../../../sandbox/layers.md)。
