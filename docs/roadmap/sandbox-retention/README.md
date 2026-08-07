# Sandbox 默认停驻与回收

一次运行结束后，用户不应提前猜中哪条 Attempt 会失败，才能保留一个可进入的 Sandbox 实例。
Sandbox 的可恢复停驻与不可恢复销毁也必须是两种不同动作，不能共用 `stop` 一词。

本主题把停驻变成有界的资源策略。
本地调用默认只考虑 `failed`、`errored` 或 cleanup 不完整的 Sandbox 实例；CI 默认销毁。
Provider 不能证明硬到期、身份核验和崩溃恢复时，默认策略同样销毁。

## 核心心智

Retention policy 先回答“哪些 Sandbox 实例值得留下”，再回答“它们怎样释放”：

| 轴 | 取值 | 回答的问题 |
|---|---|---|
| `retain` | `failed` / `all` | 哪些物理 Sandbox 进入留存候选 |
| `release` | `auto` / `retain` / `destroy` | 候选停驻还是销毁 |

`auto` 不是“Provider 有暂停方法就留下”。
Provider 还必须证明 active failsafe、服务端硬到期、稳定逻辑身份、detached 管理和完整资源发现。
缺一项就销毁。

停驻实例只保证是 **post-teardown checkpoint**。
Agent teardown、已登记 cleanup 与 Sandbox lifecycle teardown 都先执行；随后才停驻物理资源。
它适合检查完整 filesystem、workdir 外状态和手工重跑命令，不是 Verdict 瞬间快照。

## 默认策略

| 调用位置 | `retain` | `release` | 结果 |
|---|---|---|---|
| 本地调用 | `failed` | `auto` | 只让失败类候选通过 Provider 能力门 |
| CI | `failed` | `destroy` | 所有物理 Sandbox 都销毁 |
| 项目显式配置 | `failed` 或 `all` | `auto`、`retain` 或 `destroy` | 按签入策略求值 |

`failed` 包含 Verdict 为 `failed`、`errored`，以及任意 Verdict 下 cleanup 不完整的 Sandbox 实例。
`passed` 且 cleanup 完整的 fresh Sandbox 默认销毁。
正常回到 reset anchor 的复用池也默认销毁。

Docker 与 E2B 的 dormant 数据没有 Provider 硬到期，因此不通过 `auto`。
项目可以一次性声明 `release: "retain"`，不必在每次运行前指定留存 flag。
这项显式选择同时接受无界 dormant 数据的风险；CLI 必须显示该事实和回收命令。

## 与 Sandbox 复用的关系

[Sandbox 复用](../../feature/sandbox/reuse.md)仍只复用同一次 Invocation 中的活实例。
停驻是物理实例离开调度所有者后的处理，不把它变成下一次 Invocation 的干净起点。

fresh Sandbox 的 checkpoint 关联一条 locator。
复用池条目保存承接 history 与池 checkpoint；这些 locator 只表示 history，不能声称 Sandbox 实例属于其中一条 Attempt。

## 范围

本主题包含：

- `defineConfig()` 的 retention policy 与 CLI 优先级；
- managed Provider 的 suspend、wake、inspect、destroy 与 discover 能力；
- `retentionId`、持久 registry、lease、operation intent 与 reconcile；
- `sandbox list`、`enter`、`suspend`、`delete` 与 `prune`；
- fresh、复用池、中断与 release failure 的完整时序；
- post-teardown checkpoint、Invocation resource completion 与反馈。

本主题不包含：

- teardown 前复制 Verdict 瞬间的 Sandbox 状态；
- 跨 Invocation 自动复用停驻 Sandbox；
- 永久开发 Sandbox 或无界后台进程；
- 分布式 count quota；
- 为 process-scoped custom Provider 伪造崩溃恢复。

## 入口

- [Library](library.md) —— retention policy、默认值与配置求值。
- [CLI](cli.md) —— 运行 flag、管理命令、输出与退出码。
- [Architecture](architecture.md) —— Provider 能力、registry、状态机与安全边界。
- [Lifecycle](lifecycle.md) —— fresh、复用池、进入 Sandbox 和中断收尾。
- [Use Cases](use-case/README.md) —— 失败后检查、CI 销毁与 Docker 显式停驻。
