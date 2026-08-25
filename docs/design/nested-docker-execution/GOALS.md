# Goals

## 必须达到

- Coding Agent 在自己的 Sandbox 内可以使用 Docker API、CLI 与 Compose V2。
- 每条 Attempt 获得私有 daemon、container、network、volume 与 Docker data allocation。
- Agent 不能访问宿主 Docker socket、其它 Attempt 的 daemon 或宿主私有文件。
- 至少四条 Attempt 可以并发，每条 Docker data allocation 有 4 GiB hard limit。
- 稳定 setup、OCI image 与 build 结果可以跨 Attempt 加速，但私有运行状态不能泄漏。
- lifecycle owner 在 CLI 消失、进程强杀、宿主重启与部分创建后仍可从 durable facts 恢复。
- recovery、doctor 与 cleanup 只操作自己能证明 ownership 的资源。
- 单个 allocation 或 artifact 损坏时局部隔离；健康 capacity 仍可继续 admission。
- 冷、暖、并发、强杀与重启结果都可从安装后公开入口验证。
- 失败 fail closed，不回退到宿主 daemon、共享 writable Docker data 或较弱隔离。

## 不以本决策达到

- 不承诺任意 Sandbox 可以无限递归创建另一种 NiceEval Sandbox。
- 不自动重新发送已经可能产生模型费用的请求，也不再次执行有外部副作用的 Agent 工具调用。
- 不把 kept Sandbox、跨题累积状态或长期开发机作为默认评估语义。
- 不自动接管、修复或删除没有新 execution-domain identity 的旧存储。
- 不要求所有 Provider 使用同一种 VMM、guest OS 或 storage driver。
