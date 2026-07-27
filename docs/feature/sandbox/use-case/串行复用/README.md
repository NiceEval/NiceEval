# `--reuse-sandbox[=<n>]` —— 用例

`--reuse-sandbox[=<n>]` 仍会真实执行每条 Attempt，只让同一 sandbox spec 与
environment profile 的 Attempt 共用一个或多个 Sandbox。
它分摊 Sandbox 创建与 SandboxSpec `setup`，但不会让结果进入后续结果沿用或 CI。

| 目标 | 用例 |
|---|---|
| 本地快速冒烟一批 Eval | [把 N 次冷启动折成一次](批量冒烟.md) |
| 保留有限并发 | [用多个 Sandbox 分摊一批 Attempt](批量冒烟.md) |
| 批次超过一个 Sandbox 的寿命 | [在派发前更换 Sandbox](长批次更换Sandbox.md) |
| 同一题重复运行并观察稳定性 | [安装只付一次](重复运行看稳定性.md) |
| 选中的 Eval 不共享基线 | [根据报错缩小批次](异构批次.md) |
| 现有 Eval 还不能使用 Sandbox 复用 | [准备可复用的 Eval](准备可复用评测.md) |

完整契约见 [Sandbox 复用](../../serial-reuse.md)。
