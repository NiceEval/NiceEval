---
format: niceeval.memory/v1
id: e2e-signal-cleanup-waits-for-program-completion
title: E2E 顶层 signal listener 未启动运行中的取消与升级
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# E2E 顶层 signal listener 未启动运行中的取消与升级

P1；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Sol review，父 agent 独立复核。入口：`packages/e2e-runner/src/cli.ts:149`。

E2E CLI 运行长期任务时收到 SIGINT/SIGTERM，顶层 listener 只写 signalState.first；第二次 signal 只向队列写入。目标为立即停止新阶段并转发 signal，第二次升级 KILL，见 [E2E execution](../docs/engineering/testing/e2e/execution.md)。

withSignalLifecycle 把 stopOwnedProcesses 与 escalationWatcher 放在 program 的 Effect.ensuring 内，主程序尚未结束时二者都未启动。入口使用 Effect.runPromiseExit，没有额外 NodeRuntime signal interrupter。各 child 自身超时或进程组偶然收到终端 signal，不能代替顶层 owner 的取消协议。

待验证：用无 provider 的仓库命令 fixture 启动长期 owned child，向顶层 PID 发第一次 signal，观察相同 signal 到达 child、后续阶段不启动、退出状态 130/143；忽略 TERM 的 child 收到第二次 signal 后应立即 KILL。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。

## 2026-09-05 修复验收

父 agent 使用真实 E2E CLI 与 owned child 独立验收：SIGINT 返回 130（约 60 ms），SIGTERM 返回 143（约 61 ms）；子进程恰好收到一次原始信号，忽略首次信号时第二次升级 SIGKILL（约 40 ms），所有进程组回收。修复将取消监听提前到运行期，并用独立 scoped program 保持升级监听覆盖子资源释放。

实现与上述仓库入口验收已完成；当前结构化 fixed 门只接受产品 E2E 凭据，尚无仓库 DX 凭据类型，因此保留 open，不借用无关产品 case 宣称 resolved(fixed)。
