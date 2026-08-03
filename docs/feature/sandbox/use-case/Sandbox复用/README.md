# `sandboxReuse: true` —— 用例

Experiment 声明 `sandboxReuse: true` 后，指纹匹配的终态 Attempt 会照常由后续 Run 沿用，不创建 Sandbox。
未沿用的 Attempt 才共用 Sandbox，分摊创建和公共准备。
两层作者 layer 的 `prepare()` 每条 Attempt 重放；昂贵动作靠真实检查把关，复用窗口内第二条起检查命中、快速返回。

| 目标 | 用例 |
|---|---|
| 当前 lockfile 的依赖每题都要安装 | [每个复用 Sandbox 只真实安装一次](共享动态依赖安装.md) |
| 本地快速冒烟一批 Eval | [把 N 次冷启动折成一次](批量冒烟.md) |
| 保留有限并发 | [用多个 Sandbox 分摊一批 Attempt](批量冒烟.md) |
| 多开 Invocation 时决定 Sandbox 与 checkpoint 是否共享 | [并行 Invocation 与状态边界](并行Invocation与状态边界.md) |
| 批次超过一个 Sandbox 的寿命 | [在派发前更换 Sandbox](长批次更换Sandbox.md) |
| 同一题重复运行并观察稳定性 | [昂贵安装只真实付一次](重复运行看稳定性.md) |
| 选中的 Eval 各带不同 template | [复用池按物理身份分组](异构批次.md) |
| 实验声明了原生 Plugin | [声明了原生 Plugin 的实验开复用](插件实验开复用.md) |
| 现有 Eval 还不能使用 Sandbox 复用 | [准备可复用的 Eval](准备可复用评测.md) |

完整契约见 [Sandbox 复用](../../reuse.md)。
