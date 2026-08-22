# Sandbox Deployment

有些 Sandbox 初态无法只靠 image、template 或 snapshot 的静态构建完成。Docker-in-Docker 必须等 inner daemon ready 后才能导入离线 image；其它 Provider 也可能要在运行中的 staging 实例里生成可复现状态。

把这类固定工作放进 `.setup()` 会让每个新物理 Sandbox 重做一次。把任意 `.setup()` 结果直接缓存又会保存 checkpoint、临时凭据、租约或外部会话。Deployment 因而是 Build 与物理 Sandbox lifecycle 之间的独立阶段：它只接受有完整身份、可安全重试且没有外部写副作用的声明式准备，并由 Provider 把结果发布为不可变起点。

## 核心心智

```text
BuildKey ready
  → DeploymentKey lookup
    → hit: verified Deployment source
    → miss: staging Case → deploy → quiesce → publish
  → instantiate private physical Sandbox
  → setup / checkpoint restore
  → prepare / Agent / teardown
```

Deployment 缓存的是跨实例相同的干净起点，不是执行过 `.setup()` 的活 Sandbox。每个 Attempt 或复用周期仍取得自己的可写实例；共享只发生在不可变、只读的 parent。

## 四种准备位置

| 内容 | 归属 | 频次 |
|---|---|---|
| 不需要运行中 daemon 的固定系统包、归档和二进制 | image / template / snapshot build | 每个 BuildKey 构建一次并跨 Run 命中 |
| 必须等 Provider ready 后生成、跨实例相同的状态 | `.deploy()` | 每个 DeploymentKey 发布一次并跨 Run 命中 |
| checkpoint、租约、临时凭据和每物理实例动态状态 | `.setup()` / `.teardown()` | 每个物理 Sandbox 成对一次 |
| 题目文件与每 Attempt 配置 | `.prepare()` | 每个 Attempt 一次 |

`.deploy()` 不提供 `noCache`。动态工作属于 `.setup()`；稳定工作在不支持 Deployment cache 的 Provider 上可以明确地 uncached 执行。

## 范围

- Eval 与 Experiment 的 `SandboxLayer` 可以按既有 owner 顺序贡献 Deployment command；Agent 继续使用 `agent.ensure`。
- cache policy 是 `preferred | required`。任一 contribution 选择 `required`，组合结果就是 `required`。
- `preferred` 在 Provider 明确不支持缓存或缓存控制面暂时不可用时，可以带 diagnostic 在最终实例执行 uncached deployment。
- `required` 在静态 capability gate 失败时停止，不读取文件、不访问网络、不创建 Sandbox。
- recipe、quiesce、凭据隔离或 ready 失败是正确性失败，两种 policy 都不得降级继续。
- Local Sandbox 没有可发布起点；`preferred` 显示 uncached，`required` 拒绝。

## 入口

- [Library](library.md) —— `.deploy()`、`DeploymentCommand` 与 immutable input。
- [Architecture](architecture.md) —— identity、Provider SPI、DinD storage schema、隔离与 cache 生命周期。
- [Lifecycle](lifecycle.md) —— planning、single-flight、staging、instantiate、setup、取消与失败。
- [固定 DinD runtime](use-case/固定DinD运行时.md) —— canary 身份查找与 inner Docker data-root 的完整路径。
