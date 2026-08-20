# sharedState 显式恢复将 Linux zombie owner 误判为 live

## 现象

2026-08-20，已强杀的本机 sharedState owner 若仍由父进程保留为 Linux zombie，公开
`niceeval exp <selector> --teardown --recover-shared-state <key>` 能显示它的 owner evidence，却在带
exact token 与双确认后仍以 `shared-state-owner-still-live` 拒绝恢复。该 lease 没有自动接管路径，因而会永久阻塞
后续 holder。

## 根因

`processIdentityForPidEffect()` 只把 `/proc/<pid>/stat` 的 starttime 用作 Linux identity。zombie 的 starttime
仍与 durable lease 相同，虽然 `Z`、`X`、`x` 三种状态已经不能执行补偿 cleanup；identity compare 因此把终态 PID
当成 live actor。

## 裁决与修法

本机 explicit recovery 把 Linux `/proc/<pid>/stat` 的 `Z`、`X`、`x` 视为 terminated，允许已经由操作员确认的
compensating teardown 继续。只有这些明确终态可绕过 live-owner 拒绝；state 缺失、格式错误或读取失败仍作为 identity
unavailable fail closed，不能由 PID 或 starttime 单独授权恢复。

`src/runner/shared-state-lease.ts` 在解析 starttime 前严格读取 state。`e2e/runner/test/shared-state-zombie-owner-recovery.test.ts`
通过安装候选的 CLI 在外部不 reap 的父进程下制造真实 `Z` owner，再用公开 inspection 取得 token、执行 public recovery，
并确认 compensating teardown 清除 fixture 的外部状态。

## 回归收据

- 固定条件：Linux、`python3` zombie wrapper、Runner Repo 的安装后 candidate 与私有项目副本。
- 红灯：在 starttime-only identity 的候选上运行

  ```sh
  pnpm e2e --repo runner -- --run test/shared-state-zombie-owner-recovery.test.ts -t "terminal Linux zombie owner"
  ```

  结果 exit 1、`regression`；最早失败点为 public recovery 的 exit 1，stderr 为
  `sharedState owner is still live ... recovery is refused.`。candidate SHA-256：
  `009faa32b21ae3cfa8b020031e8ca236de14215cd871b133e3b323751b73c20f`。
- 绿灯：以相同命令运行 state-aware identity，结果 exit 0、`pass`；public recovery 输出
  `explicitly recovered sharedState key runner/shared-state-zombie-owner`，fixture owner child 被 wrapper reap。
  candidate SHA-256：`a9e036b01e96a48d9850e32b6b03b8725756772c5d4455bfe82493fd6d8600a3`。

## 边界

这不授权 heartbeat expiry、PID 自动接管或 remote identity 推断。远端仍要求 explicit remote-quiesced acknowledgement；
同机非终态 process、不可读 procfs 与 malformed stat 都继续拒绝恢复。
