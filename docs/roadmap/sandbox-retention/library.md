# Sandbox 默认停驻与回收 —— Library

本页定义项目级 retention policy。
命令、registry 与 Provider 能力分别见 [CLI](cli.md) 和 [Architecture](architecture.md)。

## 配置形状

```ts
interface SandboxRetentionPolicy {
  /** 候选由能力门停驻、必须停驻，或直接销毁。 */
  readonly release?: "auto" | "retain" | "destroy";
  /** 只选择失败类 Sandbox，或选择全部实际创建的 Sandbox。 */
  readonly retain?: "failed" | "all";
  /** dormant Sandbox 的空闲保留时间；必须是正有限毫秒数。 */
  readonly idleTtlMs?: number;
  /** Provider 必须强制执行的单次 active 上限；必须是正有限毫秒数。 */
  readonly maxActiveMs?: number;
  /** 单一 RecordStore 经 GC 收敛后的未过期条目数量上限。 */
  readonly maxStoppedPerRecordStore?: number;
}

interface Config {
  readonly sandboxRetention?: SandboxRetentionPolicy;
}
```

```ts
// niceeval.config.ts
import { defineConfig } from "niceeval";

export default defineConfig({
  sandboxRetention: {
    release: "retain",
    retain: "failed",
    idleTtlMs: 24 * 60 * 60_000,
    maxActiveMs: 60 * 60_000,
    maxStoppedPerRecordStore: 20,
  },
});
```

这项配置属于宿主资源策略，不属于 Eval 或 Experiment 语义。
它不进入 pair 指纹、结果携带、configHash 或 Attempt Verdict。

## 默认值与求值

内置默认如下：

| 字段 | 本地调用 | CI |
|---|---|---|
| `release` | `auto` | `destroy` |
| `retain` | `failed` | `failed` |
| `idleTtlMs` | `86_400_000` | `86_400_000` |
| `maxActiveMs` | 未设 | 未设 |
| `maxStoppedPerRecordStore` | `20` | `20` |

`CI` 是宿主执行事实。
`process.env.CI` 去掉空白后非空，且小写值不是 `0` 或 `false` 时，调用处于 CI。
项目配置可以显式替换这项默认策略；[CLI flag](cli.md#运行策略)优先级最高。

CLI 必须在 plan 与运行开头显示求值后的 `retain`、`release`、TTL 和 Provider 处置。
同一命令不能因为输出是否连接 TTY 而改变策略。

Runner 从 Provider session 上限、Invocation deadline、Attempt deadline 与 `maxActiveMs` 中取最早时刻，写成 Provider 可强制执行的 active deadline。
这四项都不能给出有限上界时，显式 `retain` 在创建资源前报错；`auto` 则得出 `destroy`。

## `retain` 选择

| 物理 Sandbox | `failed` 是否选择 | `all` 是否选择 |
|---|---:|---:|
| fresh 的 Verdict Claim 为 `failed` / `errored` | 是 | 是 |
| fresh 的 Verdict Claim 为 `passed`，cleanup 完整 | 否 | 是 |
| fresh cleanup 不完整 | 是 | 是 |
| pool 因失败或不安全状态退休 | 是 | 是 |
| pool 正常回到 reset anchor | 否 | 是 |
| Judge fresh 的 Verdict Claim 为 `failed` / `errored`，或 cleanup 不完整 | 是 | 是 |

carried Attempt、只有 Run-scoped `skipped` Verdict Claim 的未派发成员与尚未派发的工作都没有本次物理 Sandbox，不产生候选。
一台复用池实例只选择一次，不按它承接的 Attempt 数重复计算。
Judge Sandbox 按裁判自身 execution 与 cleanup 选择，不借用父 Attempt 的 Verdict。

## `release` 处置

`destroy` 对所有候选执行不可恢复销毁。
未被 `retain` 选中的物理 Sandbox 也直接销毁。

`auto` 只在 managed Provider 同时满足以下条件时停驻：

1. 创建期 active failsafe 有硬上界；
2. dormant 数据由 Provider 在 `idleTtlMs` 内强制到期；
3. logical identity、inspect、wake、suspend 与 destroy 可跨进程恢复；
4. provision token 可以发现完整的主 Sandbox、sidecar、network 与 volume；
5. 所有破坏动作都能核验归属与 lease。

能力门不满足时，`auto` 得出 `destroy`，并在 plan 中显示原因。
这项回退不是配置错误。

`retain` 是显式要求。
Provider 没有 managed controller、active failsafe 或可靠身份核验时，规划在创建资源前报错。
Provider 只有 dormant 硬到期缺失时仍可接受，但反馈必须标出 `no provider expiry`。

## TTL 与本地数量上限

`idleTtlMs` 在 registry 条目创建时求值并固化为 `pruneAfter`。
Provider 支持硬到期时，controller 同时写入不晚于该时刻的 `providerExpiresAt`。
`auto` 不接受无限值，也不把 Provider 最小期限静默改短或改长。

`maxStoppedPerRecordStore` 是单一 `.niceeval/` RecordStore registry 的收敛数量，不是全项目成本上界。
并发 Invocation 可以短暂超过它；其它 checkout 与 CI runner 不在同一计数中。
跨 runner 的硬边界只来自 `providerExpiresAt`。

## Custom Provider

process-scoped custom Provider 只实现 live `destroy()`。
`auto` 对它得出 `destroy`；显式 `retain` 在规划期报错。

custom Provider 在正常返回、错误、timeout 与 Ctrl+C 时仍由 Scope 销毁。
它没有可序列化 controller 或 metadata 查询时，NiceEval 不承诺在 `SIGKILL` 或断电后发现资源。
