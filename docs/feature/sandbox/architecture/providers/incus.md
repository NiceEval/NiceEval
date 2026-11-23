# Incus Provider —— 架构

Incus Provider 的实现。公开用法见 [Incus](../../library/providers/incus/README.md)；所有 Provider 共用的契约见 [Architecture](../README.md)。

## 实例

Experiment 用 `incusSandbox()` 选择一次性 VM。
guest 执行身份是 `node` uid 1000，workdir 是 `/home/sandbox/workspace`，`otlpHost` 为 `null`。
guest 内运行普通 dockerd，不是 Docker-inside-Docker。
V1 DestroyOnly；requirement / capability、domain 与 doctor 见 [Nested Docker](../../../sandbox-nested-docker/README.md)。
