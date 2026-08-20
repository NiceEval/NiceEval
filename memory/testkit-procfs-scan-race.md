# Testkit 单次 procfs terminal scan 会遗漏 post-snapshot descendant

## 现象

2026-08-20，owned Linux process group 在收到 SIGTERM 后，成员可以在 Testkit 已取得 `/proc` 目录快照、但尚未读取
该成员 stat 前 fork 一个同组 descendant 并退出。单次 scan 只看见已经消失或 terminal 的旧成员，错误接受
terminal-only，留下 live descendant。

## 根因

procfs 目录枚举和逐 PID stat 读取不是原子快照。此前 E2E 依赖 `SIGUSR1`、一毫秒 busy wait 与 PID 枚举顺序让 fork
恰好落在窗口内，不能稳定证明旧实现真的漏杀；其 finally 还吞掉了 group、reaper 与 padding cleanup 失败。

## 裁决与修法

`ProcessHandle` 在 SIGTERM 后必须以独立连续的 procfs scan 确认 terminal-only。Testkit 增加每个 handle 专属的
post-TERM snapshot seam，仅供 Lifecycle E2E 在 `readdirSync("/proc")` 完整返回后握手；fixture 在该 seam 后 fork，
使 descendant 确定不在被测 snapshot 中。第二次 scan 看到 live child 后走 grace → SIGKILL，外部 subreaper 物理 reap 它。

fixture 的 padding supervisor 和 workers 特意在 owned group 外；测试逐一确认 supervisor、全部 workers、race reaper、
descendant 与 owned group 都终结。cleanup error 收集为 `AggregateError`，不再被 finally 吞掉。

## 回归收据

- Owner：`e2e/lifecycle/test/process-group-zombie-cleanup.test.ts`，
  `docs/engineering/testing/e2e/README.md#process-group-terminal-state`。
- 固定条件：Linux、`python>=3.11`、Lifecycle `PR_SET_CHILD_SUBREAPER` wrapper、Testkit snapshot hook。
- 红灯：把 `waitForOwnedGroupExit()` 的 terminal branch 逆为单次 `return true` 后运行

  ```sh
  pnpm e2e --repo lifecycle -- --run test/process-group-zombie-cleanup.test.ts -t "post-TERM procfs scan"
  ```

  结果 exit 1、`regression`；最早失败点为 `procfs scan race descendant <pid> to be terminated` 在 1 秒后超时。
  Candidate SHA-256：`a9e036b01e96a48d9850e32b6b03b8725756772c5d4455bfe82493fd6d8600a3`；inverse Testkit
  snapshot SHA-256：`f35e3c6f2470e3f5cd656e72473565ddf4eddec9c4becd766ccaee39e723a6d0`。
- 绿灯：恢复连续 scan 后同命令 exit 0、`pass`，单项 271ms 通过；Testkit snapshot SHA-256：
  `9935b56b5325dcaf3e449514d282d915cd8a0a27820fb22cdddc060364f678fd`。

## 边界

terminal-only 例外只适用于可读取并连续确认 `Z`、`X`、`x` 的 owned group。任何 live member、orphan 或 procfs
不确定性仍必须走 TERM → grace → KILL 并在无法终结时上抛 cleanup failure。
