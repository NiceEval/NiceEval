# `sandboxReuse: true` —— 用例

Experiment 声明 `sandboxReuse: true` 后，仍会真实执行每条 Attempt，
只让它们共用 Sandbox。它分摊 Sandbox 创建与 SandboxSpec `setup`，
但不会让结果进入后续结果沿用。

| 目标 | 用例 |
|---|---|
| 当前 lockfile 的依赖每题都要安装 | [每个复用 Sandbox 只安装一次](共享动态依赖安装.md) |
| 本地快速冒烟一批 Eval | [把 N 次冷启动折成一次](批量冒烟.md) |
| 保留有限并发 | [用多个 Sandbox 分摊一批 Attempt](批量冒烟.md) |
| 批次超过一个 Sandbox 的寿命 | [在派发前更换 Sandbox](长批次更换Sandbox.md) |
| 同一题重复运行并观察稳定性 | [安装只付一次](重复运行看稳定性.md) |
| 选中的 Eval 使用不同环境配置 | [按环境配置分别复用](异构批次.md) |
| 现有 Eval 还不能使用 Sandbox 复用 | [准备可复用的 Eval](准备可复用评测.md) |

完整契约见 [Sandbox 复用](../../reuse.md)。
