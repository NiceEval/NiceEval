# Testkit 将 zombie-only owned process group 误判为活组

## 现象

2026-08-19，CI 连续两次在 `e2e/report/test/report-config-reload.test.ts` 正文完成后失败：
`ProcessHandle.dispose()` 已依次发送 SIGTERM 和 SIGKILL，却仍报
`process group <pid> still exists after SIGTERM and SIGKILL`。失败 PID 分别为 762 和 752。

这不是 Report 的 revision owner 失败，而是 Linux 内核仍让 `signal 0` 看见被 PID 1 接管、但尚未 reap 的
zombie process group member；对该成员再发 TERM 或 KILL 都不会改变状态。

## 根因

旧的 `ProcessHandle.ownedGroupExists()` 只以 `process.kill(-pgid, 0)` 判断进程组是否存在。Linux 对只含 zombie
的组仍成功返回，因此 cleanup 把不可终止的终态当作活进程，等完两轮 grace 后稳定抛错。

## 修法

`packages/testkit/src/process-lifecycle.ts` 在 Linux 上读取 procfs 成员状态：组里只有 `Z` / `X` / `x` 时按终态处理；
任何非终态成员仍存活，procfs 无法可靠读取时继续 fail-closed。Lifecycle owner 用 Testkit 的安装后 snapshot，而非源码直调，
在由 `PR_SET_CHILD_SUBREAPER` 固定的 Linux fixture 中制造唯一 `Z` 成员，再自行 reap 该 fixture 资源。

## 回归收据

- Owner：`e2e/lifecycle/test/process-group-zombie-cleanup.test.ts`，
  `docs/engineering/testing/e2e/README.md#process-group-terminal-state`。
- 固定条件：Linux、`python>=3.11`、Lifecycle manifest 的 `PR_SET_CHILD_SUBREAPER` wrapper；fixture 明确断言
  process group 的唯一成员为 `Z`，并确认旧 probe `kill(-pgid, 0)` 成功。
- Candidate：checkout HEAD `305bd27c9403986fcf11b9ad6a67e9ac140cb658`；同一 candidate SHA-256
  `4886b759eaa4b0a0891bfcd2ae5dd27d0d4eba671218cd9853306b0af24a300b`。
- 红灯：仅把 `ownedGroupExists()` 的
  `return linuxProcessGroupHasRunningMember(this.pid) ?? true` 逆为旧实现 `return true` 后运行：

  ```sh
  pnpm e2e --repo lifecycle -- --run test/process-group-zombie-cleanup.test.ts -t "owned Linux process group"
  ```

  结果 exit 1、`regression`；测试在 cleanup 阶段 365ms 后失败，最早错误为
  `process group 3030353 still exists after SIGTERM and SIGKILL`。
- 绿灯：恢复当前 procfs 判定，以完全相同命令运行，结果 exit 0、`pass`；单项测试 157ms 通过，fixture helper 随后 reap
  zombie，组物理消失。
- 接管门：使用同一 candidate 执行 `pnpm e2e takeover --candidate <candidate.tgz> --repo lifecycle --artifact-root <root> -- --run test/process-group-zombie-cleanup.test.ts -t "owned Linux process group"`；
  三份隔离副本、同一已安装副本连续两次、Lifecycle 默认并行和文件/标题单项均为 `pass`，六份 receipt 的 cleanup 都为 `true`，
  source snapshot digest 为 `71888400afd9eab9d1895cfb5df2808c321182722583c815088bca9fab5e3ed0`。

## 适用场景

Linux 的 detached process group cleanup。这个例外只覆盖可证明为 terminal-only 的组；真实运行成员、orphan，或 procfs
读取不确定时都必须保持 TERM → grace → KILL 和失败收据，不能把它们降级为成功。
