# PLAN-10 用例覆盖

契约单源始终在 [Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本目录只展示同一套 Layer、固定顺序与 pair-local root 怎样完成真实用户目标。

- [Terminal-Bench：Eval root 与 Experiment extension](Terminal-Bench.md)
- [MemoryBench：Experiment root 与 Eval extension](MemoryBench.md)
- [混合模板矩阵：一个 Run 中的多个 root](混合模板矩阵.md)

| Case | PLAN-10 路径 |
|---|---|
| C1 | Eval 的 Docker Compose / Dockerfile root layer |
| C2 | Experiment root 或 prepare command；Agent 前逐 Attempt检查 |
| C3 | root author、另一 author、Agent 固定串行 |
| C4 | 同 layer 的 command 按阅读顺序串行 |
| C5 | 预装让实际检查命中，不删除 command |
| C6-C7 | State 独立，普通 layer 每 Attempt 重放 |
| C8 | Experiment E2B root、Eval checkout、AgentProvisioner |
| C9 | 不兼容时使用唯一融合 root 或拆 selector |
| C10 | template 唯一性按 pair；Run 可包含多个 root 与 Provider |
| C11 | send 后使用普通 Sandbox API 上传和判分 |
