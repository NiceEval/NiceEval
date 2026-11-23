# Incus

`incusSandbox()` 为每条 Attempt 创建一次性 Incus VM，是 Nested Docker requirement 的推荐路径。内部实现见 [Incus Provider 架构](../../../architecture/providers/incus.md)。

## Nested Docker 推荐路径

普通 `dockerSandbox({ source })` 继续提供 Docker image / Dockerfile 单容器执行；它适合 Agent 不需要控制另一层 Docker daemon 的任务。

Agent 要在 Sandbox 内运行 Docker 或 Compose 时，Eval 用 `sandboxRequirements()` 声明 provider-neutral 的 `docker/v1`、Compose、专用 kernel 与最低 data capacity。Experiment 用 `incusSandbox()` 选择 Host 管理的 Incus project、storage pool 与 digest-pinned trusted image。完整公开形状、资源字段、capability receipt 与错误码见 [Nested Docker Library](../../../../sandbox-nested-docker/library.md)。

Incus 为每条 Attempt 创建一次性 VM。guest 内运行普通 dockerd，Docker data 使用与 root / workspace 分开的私有 virtual disk；`resources.cpus`、`memoryBytes` 与 `dockerDataBytes` 进入 identity 和容量检查。Before cache 复用完整、可验证的 immutable Provider artifact，每个 consumer clone 私有 writable root / data disk。

raw privileged / managed rootless DinD、privileged outer container、inner daemon data-root clone / capture 均不属于支持目标，也不能在 Incus planning 失败时作为 fallback。宿主 Docker socket不能满足 `dedicated-kernel/v1`；可信本地工具若需要该能力，必须另立 capability 与 trust boundary。普通 Docker provider 本身不受这项迁移影响。

Incus guest 的 `otlpHost` 为 `null`。Runner 在 Sandbox 内启动 attempt-scope OTLP receiver，Agent 只访问 `127.0.0.1`。作者已经提供受控 tunnel / 可达路由时，可用 `defineConfig({ telemetry: { host } })` 显式改走宿主 receiver。
