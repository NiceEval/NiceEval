# E2E 主证明

本目录只放必须穿过真实公开边界的 Behavior 主证明：候选包、子进程、外部 cwd、HTTP、浏览器、signal、
sandbox 或下一次消费者。纯计算、schema、组合矩阵和可控竞态归 [Unit](../unit/README.md)，媒介解析词归
[DSL](../dsl/README.md)。

## 存在资格

一条 E2E 必须同时满足：它证明稳定用户结果；更低层不能观察该边界；它是该 Behavior 的唯一主证明；fixture
不依赖付费模型时就不得引入模型。一个 Behavior 内可以跑若干必要宿主 scenario，但不能为每个 scenario 铸一个
Behavior ID。

完整目标用例见 [Use Cases](use-case/README.md)，可直接照着落盘的文件结构见 [Example](../example/README.md)。
独立消费方项目的候选包安装、lockfile 与命令边界见 [`consumer-project` backend](consumer-project-backend.md)。
