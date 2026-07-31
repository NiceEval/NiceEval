# 一次性沙箱拿不到 deadlineAt,每条命令各拿一整份 timeoutMs

**状态**:发现,未修(2026-07-31,做 `--timing` 时限归属标注时顺带发现)。

## 现象

`docs/feature/sandbox/architecture.md`「时限归属」声明:单条命令未显式传 `timeout` 时,上限是 attempt deadline 的**剩余量**。
一次性沙箱(非复用池)上的第二、第三条命令实际拿到的是一整份 `timeoutMs`,不是剩余量——声明 20 分钟上限的 attempt,里面每条命令各自都能跑到 20 分钟。

## 根因

`deadlineAt` 只有复用池那条路径传得下去:`sandbox-pool.ts` 调 `createSandboxInstance({ ..., deadlineAt })`。
一次性路径 `createMaterializedCase()` → `createSandboxInstance()`(`src/sandbox/resolve.ts` 的 on-demand-build 与 prebuilt/base 两个分支)只传 `timeout`,不传 `deadlineAt`。
于是 `commandLimit()` 的 base 里只有 `commandTimeoutMs`,走的是「无 deadline」那一档,每条命令重新拿一整份。

用户看不到 attempt 跑超,是因为 runner 的 `Effect.timeoutTo` 硬边界照样在 deadline 那一刻中断整段 body——命令的线松了,attempt 的线还在,症状被上一层盖住。

## 修法

把 `deadlineAt` 接进 `createMaterializedCase` 的选项并透传给两处 `createSandboxInstance`,与复用池同一个字段同一个语义;`attempt.ts` 已经算好这个时刻(`const deadlineAt = Date.now() + attemptTimeout.timeoutMs`),只差把它跟着 `timeout` 一起递下去。
一条区分力测试:同一台一次性沙箱上跑两条命令,第二条拿到的上限必须小于第一条。
