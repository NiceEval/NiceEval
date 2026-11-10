# 准备缓存损坏时回到干净起点

场景：Docker image 或远端 snapshot 的登记仍在，但 Provider 已删除对应对象、返回了不同 identity，或无法完成 restore。
Before cache 只负责加速，不能决定 Eval 能否运行。

普通 Docker 与 E2B 的复用配对在每条 Attempt 内核对最长 `verified` Before cache。候选无法双向验证时，Runner 隔离该候选，
最多一次从更短的 verified prefix 或作者声明的 Base 创建私有 Sandbox，并真实执行剩余 before action。
E2B、OpenSandbox 与 Instabox 的其余配对从 Run 准备的 snapshot 创建实例；snapshot 已删除或 manifest 不一致时，
该 Attempt 同样最多一次从 Base 重建并真实执行全部 before。
运行反馈把这次满足记为 `degraded`，同时产生指向被隔离 operation 的 `cache-degraded` diagnostic。

如果 Base 仍能建立，Agent 与 Eval 继续运行；损坏的缓存不能让同批其它 Attempt 在派发前一起失败。
如果连干净 Base 都无法建立，只有当前 Attempt 形成带 locator 的 `errored` 结果。Human 输出展示安全封口后的真实错误，
并用所属 Run 的 `niceeval view --run <runId>` 下钻。

```text
before cache: degraded · restore failed · replayed from base
diagnostic: cache-degraded · operation before-cache.restore
```

这条路径不接管用户声明的 Docker image、E2B template 或 snapshot，也不按名称、年龄或“当前 Run 未使用”删除它们。
NiceEval 创建的旧 generation 只有在新 generation 已发布且没有 private clone、lease 或 capture 使用时才可淘汰；
删除失败保留登记并在后续重试。

## 与孤儿 Sandbox 的边界

Docker cache image 与 E2B setup snapshot 不是正在运行或留存的 Sandbox。强杀后遗留的 Docker container 或 E2B Sandbox 通过底层 Provider 原生管理工具（如 `docker ps -a` / `docker rm`）核对回收，不列 Docker cache image 或 E2B setup snapshot；准备缓存也不被普通容器删除操作销毁。

Incus prepared artifact 不走这条降级路径。它由 Run 级 coordinator 在派发前发布；Provider inventory、
双向 metadata 与 `ArtifactIntent` 无法闭合时必须 fail closed，并通过 Incus doctor 报告 exact Provider object locator。
