---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# MemoryBench：分组复用记忆条件与 Git seed

契约单源见 [Library](../library.md)、[Architecture](../architecture.md) 与
[Lifecycle](../lifecycle.md)。本页只说明 MemoryBench 的组合方式。

MemoryBench 把同一记忆条件下、物理 Sandbox 计划兼容的 Eval 切成多个 Group。每个 Group 使用一台
Docker Sandbox 串行运行成员；多个 Group 同时占用 Experiment 的并发位。这样既复用昂贵的
记忆工具与 Agent setup，也不会把整批评估压成一条长串行队列。

仓库准备由 MemoryBench 自己的 Eval Plugin resource 持有，不进入 NiceEval 官方 Plugin：

1. resource `materialize` 为当前物理 Group 建立一次 bare Git seed，并执行唯一一次远端 fetch；
2. 每条真实 Attempt 的 `prepare` 从本地对象库复制需要的对象，再 detached checkout 到题目目录；
3. prepare 不执行 clone、fetch、pull，也不依赖远端 refs、alternates、hooks 或 reflog；
4. resource release 只释放仍存活的宿主资源，不在 Sandbox 销毁后重复执行容器命令。

因此远端 Git 工作量按实际 Group 数增长，不按 Eval 数增长。具体仓库 URL、revision、凭据与
目录规则仍属于 MemoryBench；NiceEval core 只负责 resource lifecycle、Group lane / pool 与调度。

Remem、Obelisk 等固定版本的文档型 Skill 随 MemoryBench vendored，Plugin identity 包含
上游 revision。Agent Extension 使用 `kind: "local"` 上传，不在每条 Attempt 重新 clone。
