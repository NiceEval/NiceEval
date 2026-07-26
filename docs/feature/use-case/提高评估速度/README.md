# 如何提高评估速度

提速不是一个开关。先判断时间花在哪里：

| 瓶颈 | 选择 |
|---|---|
| 没改的 Eval 仍在重复执行 | [检查哪些改动会作废结果](../../experiments/use-case/缓存与沿用/README.md) |
| 修复后只需复验旧失败 | [只复验失败项](../../experiments/use-case/重新运行/复验失败项.md) |
| 只关心是否至少成功一次 | [`--early-exit`](../../experiments/use-case/首过即停.md) |
| 独立 Eval 没有吃满可用资源 | [独立评测并行执行](../../experiments/use-case/并发/独立评测并行执行.md) |
| 本机或 Provider 容量需要手动调整 | [限制全局并发](../../experiments/use-case/并发/限制全局并发.md) |
| Sandbox 冷启动和公共安装占大头 | [批量冒烟时串行复用](../../sandbox/use-case/串行复用/批量冒烟.md) |
| 同一题重复运行，安装成本反复出现 | [重复运行看稳定性](../../sandbox/use-case/串行复用/重复运行看稳定性.md) |

缓存沿用会跳过执行；Sandbox 串行复用仍真实执行，只复用环境。二者不能统称为同一种“复用”。
