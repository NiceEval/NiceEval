# 约束与候选方案

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [DECISION](DECISION.md)

---

## 不同问题需要不同办法

| 办法 | 省掉什么 | 不解决什么 |
|---|---|---|
| 结果沿用、选择、首过即停 | 不需要执行的 Attempt | 必须执行的 Attempt 有多慢 |
| 有界并发 | 独立 Attempt 的排队 | 单条 Attempt 与 Provider 容量上限 |
| 预制环境 | 重复安装稳定依赖 | 实例创建与随实验变化的准备 |
| Sandbox 预热 | 把实例创建移出 Attempt 路径 | SandboxSpec Hook 仍逐 Sandbox 执行 |
| Sandbox 复用 | 多条 Attempt 分摊实例创建与 SandboxSpec `setup` | workdir 之外的状态残留 |

这些办法可以组合。只有 Sandbox 复用降低 Attempt 间隔离，必须显式开启。

## 生命周期 Hook

SandboxSpec `setup` / `teardown` 是每 Sandbox 一次。
Agent 与 Eval `setup` / `teardown` 是每 Attempt 一次，必须继续成对执行。

原设计曾把 `SandboxAgent.setup` 提升成整组一次，却仍让 Agent `teardown` 逐 Attempt 执行。
这违反 Agent 生命周期契约，也可能把 Attempt 状态留给下一题。

稳定的 Agent CLI 安装应进入预制环境或 SandboxSpec Hook。
Runner 不能因为安装内容看起来稳定，就改变 Agent Hook 的调用次数。

## workdir reset 不是完整隔离

分类账只能把被跟踪的 workdir 内容重置到复用 Sandbox 的题间重置点。
`$HOME`、`/tmp`、全局安装、后台进程、排除目录和外部服务状态仍会跨 Attempt 存活。

Provider 中立接口无法完整清理这些状态。
因此，Sandbox 复用必须写进 Experiment 并进入配置哈希。
结果不得进入结果沿用；CI 可以运行这个已签入的 Experiment。

## Provider 限制

Provider 的运行时限、续期、暂停和 snapshot 能力会随产品与套餐变化。
Runner 不能写死某个分钟数，只能依赖能力接口。

- E2B 支持续期，也支持 pause / resume。连续运行仍受套餐上限约束；pause 后恢复会重新开始连续运行时限：[Sandbox lifecycle](https://e2b.dev/docs/sandbox)、[Persistence](https://e2b.dev/docs/sandbox/persistence)。
- Vercel Sandbox 把 session duration 与持久化分开处理：[Duration and persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence)。
  snapshot 会停止创建它的当前 Sandbox，适合制作后续 Sandbox 的起点，不适合作为题间原地 reset：[Snapshots](https://vercel.com/docs/vercel-sandbox/concepts/snapshots)。
- Docker Provider 有孤儿回收 TTL。复用时不能只按一条 Attempt 的 `timeoutMs` 设置 TTL。
- 自定义 Provider 如果只能 `stop()`，无法证明现有 Sandbox 还能承接下一条 Attempt。

## 候选方案

| 方案 | Attempt 间隔离 | 可保留并行 | 分摊创建与 SandboxSpec `setup` | Sandbox 寿命 |
|---|---|---|---|---|
| 全新 Sandbox + 预制环境 + Sandbox 预热 | 是 | 是 | 否 | 每 Attempt 独立 |
| 一个 Sandbox 串行执行整批 | 否 | 否 | 是 | 整批依赖一个 Sandbox |
| 一个或多个 Sandbox 复用 | 否 | 是 | 每个 Sandbox 分摊 | 派发前续期或更换 |

## 共通约束

- 并发越高不一定越快，Agent Provider、Sandbox Provider 和本机资源都有容量上限。
- Sandbox 预热太早会消耗 Sandbox 寿命和计费时间，只能按近期派发量创建。
- 提前检查寿命只能处理可预见的到期。Sandbox 在 Attempt 中途消失时，Attempt 仍记为 `errored`，不能静默重跑。
- sandbox spec 或 environment profile 不同的 Attempt 不能共用一个题间重置点。
