# Sandbox 复用

`--reuse-sandbox[=<n>]` 让一次 Run 里的多条 Attempt 共用一个或多个 Sandbox。
每个 Sandbox 内部串行执行；同时维护多个 Sandbox 时，它们之间可以并行。

裸 `--reuse-sandbox` 等价于 `--reuse-sandbox=1`。
这只表示最多维护一个 Sandbox，不是另一套 Feature。
选型过程见[实验加速 Design](../../design/experiment-speed/README.md)。

## 动机

本地迭代可能重复支付 Sandbox 创建、SandboxSpec `setup` 和稳定依赖安装。
Sandbox 复用分摊 Sandbox 创建与 SandboxSpec `setup`，
但不会自动分摊 Agent 或 Eval 内执行的安装。

默认模式仍为每 Attempt 使用全新 Sandbox。
Sandbox 复用必须显式开启，因为 workdir 之外的状态会跨 Attempt 存活。

## 入口与有效宽度

```bash
niceeval exp memory/commit0 --reuse-sandbox
niceeval exp memory/commit0 --reuse-sandbox=2 --max-concurrency=4
```

N 必须是正整数，表示本次 Run 最多维护的 Sandbox 数。
Runner 按需创建，不因为值较大就一次创建全部 Sandbox。

有效宽度不超过以下三者的最小值：

1. `--reuse-sandbox` 指定的 Sandbox 数；
2. 全局并发位；
3. Experiment 的 `maxConcurrency`。

因此，`maxConcurrency: 1` 的 Experiment 即使传 `--reuse-sandbox=4`，仍一次只派发一条 Attempt。
这保留共享状态临界区与确定顺序等串行要求。

计划与结束反馈展示请求数量、实际创建数量、有效宽度、复用次数和更换次数。
Sandbox 复用是本次 Invocation 的运行方式，不进入 `defineExperiment`。

## 选题要求

选中的 Eval 必须解析到同一个 sandbox spec 与同一个
[`environment` profile](library/prebuilt-environments.md#按-environment-选预制产物)。
不满足时，Runner 在创建 Sandbox 前列出分组并报错。

Runner 不自动跨组创建 Sandbox。N 表示整次 Invocation 可同时维护的 Sandbox 上限，
不表示每个环境各创建 N 个。

## 每个 Sandbox 的生命周期

```text
createSandbox
  → SandboxSpec.setup
  → 建立复用 Sandbox 的题间重置点
  → Attempt A
  → reset
  → Attempt B
  → reset
  → …
  → SandboxSpec.teardown
  → stop
```

### Hook 次数

| 生命周期阶段 | Sandbox 复用时 |
|---|---|
| `createSandbox` | 每个 Sandbox 一次 |
| SandboxSpec `setup` / `teardown` | 每个 Sandbox 成对一次 |
| Eval `setup` / `teardown` | 每 Attempt 成对一次 |
| Agent `setup` / `teardown` | 每 Attempt 成对一次 |
| `test(t)`、评分与证据收集 | 每 Attempt 一次 |

Runner 不能把 Agent `setup` 提升成每个 Sandbox 一次。
其中若有稳定 CLI 安装，应移进预制环境或 SandboxSpec Hook。

这条边界使默认模式与 Sandbox 复用只在 SandboxSpec 生命周期上不同。
Adapter 不需要探测 Sandbox 是否被多条 Attempt 共用。

## 题间重置点

SandboxSpec `setup` 完成后，Runner 在分类账上建立
**复用 Sandbox 的题间重置点**。每条 Attempt 开始前，workdir 必须处于这个点。

上一条 Attempt 的证据折叠完成后，Runner：

1. `git reset --hard` 回到题间重置点；
2. 按分类账排除清单执行 `git clean`；
3. 重新建立本 Attempt 的归因窗口；
4. 重放 Eval Fixture，再运行 Agent 与 `test(t)`。

reset 失败时，该 Sandbox 不再承接 Attempt。
后续 Attempt 等待其它 Sandbox 或新创建的替代 Sandbox。

## Sandbox 复用寿命

长批次不能假设同一个 Sandbox 一直存活。
每个支持 Sandbox 复用的 Provider 都要提供中立能力：

```typescript
interface SandboxReuseCapability {
  ensureLifetime(minRemainingMs: number): Promise<
    | { ready: true; expiresAt?: string }
    | { ready: false; reason: string }
  >;
}
```

Runner 在每次派发前请求足以覆盖 Attempt deadline 与收尾预留时间的 Sandbox 复用寿命。
Provider 可以在 `ensureLifetime` 内续期，也可以只确认现有寿命。

- 返回 `ready: true`：该 Sandbox 可以承接 Attempt。
- 返回 `ready: false`：停止该 Sandbox，并创建替代 Sandbox。
- Provider 没有这项能力：在创建前报错。

替代 Sandbox 完成 SandboxSpec `setup` 后再次检查寿命。
如果 setup 已消耗过多时间，本次 Run 报错并展示阶段耗时与 Provider 理由，
不反复创建同样的替代 Sandbox。

Sandbox 在 Attempt 中途消失时，该 Attempt 记为 `errored`。
Runner 不静默重跑，因为 Agent 可能已经产生成本或外部副作用。

收尾预留时间是 Runner 内部设置，不是公开 CLI flag。
它依据收尾阶段耗时设置保守下限。

## 状态边界

题间 reset 只恢复分类账跟踪的 workdir 内容。以下状态不会被完整重置：

- `$HOME`、`/tmp` 与全局安装；
- 后台进程和端口；
- Agent CLI 自己的 cache 与配置；
- 分类账排除的依赖和构建目录；
- Sandbox 外部服务中的副作用。

因此，Sandbox 复用可能改变判定。
启动反馈必须说明多条 Attempt 会共用 Sandbox；
Attempt 记录 `sandbox.reused`、本次 Run 内的 Sandbox 编号和该 Sandbox 已承接的 Attempt 序号。

默认模式是正式复验路径。
NiceEval 不增加 Provider 特定的深度清理规则，也不把 workdir reset 描述成全新 Sandbox。

## 与其它能力组合

- **结果沿用**：Sandbox 复用不消费结果沿用，复用结果也不供后续 Run 沿用。
- **`--rerun`**：组合合法，但没有结果沿用可关闭。
- **`runs > 1`**：Attempt 照常分配给 Sandbox；同一个 Sandbox 内仍串行，每次运行前 reset。
- **首过即停**：语义不变，取消的 Attempt 不触发新 Sandbox 创建。
- **`--keep-sandbox`**：互斥。最终现场不只属于某一条 Attempt。
- **`localSandbox()`**：互斥。本地运行没有实例冷启动，reset 还会改动用户工作树。
- **预制环境**：优先使用，先把稳定安装移出 Attempt。
- **Sandbox 预热**：只用于默认模式；Sandbox 复用按需创建，不叠加另一组预创建 Sandbox。

## 故障与反馈

以下故障使对应 Sandbox 不再承接 Attempt：

- 续期或寿命确认失败；
- 题间 reset 失败；
- SandboxSpec `teardown` 或 `stop` 失败；
- Provider 在 Attempt 中途停止 Sandbox。

如果其它 Sandbox 仍可派发，Runner 继续处理剩余 Attempt。
替代 Sandbox 重复出现相同 SandboxSpec `setup` 错误时，
交给既有失败分类与止损机制，避免无限补充。

人读结束反馈至少包含：

```text
Sandbox reuse: 2 sandboxes · 18 attempts · 14 reused · 1 replacement
Results excluded from carry-forward and CI: sandbox state was reused
```

机器输出增加相同的 Run 级字段。
Attempt 的 `sandbox.reused` 用于结果沿用资格；
Sandbox 编号与承接序号只用于诊断。

## 非目标

- 不改变默认的每 Attempt 全新 Sandbox。
- 不跨 Run 保留 Sandbox，也不引入常驻 daemon。
- 不自动把不同 sandbox spec 或 environment profile 拆成多组。
- 不完整清理 workdir 之外的状态。
- 不让复用结果进入结果沿用或 CI。
- 不在 Sandbox 中途消失后自动重跑 Agent。

## 相关阅读

- [实验加速 Design](../../design/experiment-speed/README.md) —— 真实记录、方案比较与决策。
- [提高评估速度](../use-case/提高评估速度/README.md) —— 从阶段耗时选择办法。
- [预制环境](library/prebuilt-environments.md) —— 把稳定安装移到构建期。
- [Architecture](architecture.md) —— 生命周期、分类账与 Provider 实现。
- [Runner](../../runner.md) —— 派发、有效宽度与 Sandbox 预热。
- [CLI 用例](use-case/串行复用/README.md) —— 一个和多个 Sandbox 的用户路径。
