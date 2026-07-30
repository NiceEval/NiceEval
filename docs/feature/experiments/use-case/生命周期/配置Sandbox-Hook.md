# 用 Sandbox Hook 准备实验环境

同一批 Eval 共享、但会随 Experiment 改变的 Sandbox 内准备逻辑，放在 Sandbox spec 的链式 `setup` / `teardown` Hook。
典型用途是安装实验专用二进制、写协议配置或载入跨 Attempt 状态。

Hook 在变更分类账锚点之前运行，不属于 Agent 对任务的修改。
需要跨 Attempt 载入和回存同一份状态时，还要把该 Experiment 设为串行；选择方式见[并发用例](../并发/)。

连接 Agent CLI 与鉴权属于 `SandboxAgent.setup`，不要放在这里。
