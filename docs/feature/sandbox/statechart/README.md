# Sandbox 的状态

Sandbox 的准备、缓存与回收涉及多个配对、进程与宿主守护进程之间的交错，进程还可能在任意一步退出。这里的页面用模型检查器穷举这些交错，核对 Sandbox 声明的规则；每页先写规则，再给模型与检查结果。

- [Before cache](before-cache.md) 核对准备图放行、Attempt 内的前缀、普通 Docker 镜像保护和缓存冲突告警，规则见 [Before cache 架构](../architecture/before-cache.md)。
- [复用池](reuse-pool.md)：Sandbox 的借出、归还、退休与关池，规则来自[复用](../library/reuse.md)。
- [Provider 创建应答丢失与孤儿回收](provider-orphans.md)：应答丢失、进程退出后实例仍能找到并回收。
- [远端 snapshot 账本](remote-snapshot-ledger.md)：发布权、运行与实例的保护、结果不明的创建与延迟删除。
