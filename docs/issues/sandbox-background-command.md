# Sandbox has no public background command with wait

## 观察

Eval 需要在 Sandbox 里运行几十分钟的命令（例如外层隐藏集验证：在原项目和改后项目上各跑多轮 NiceEval 实验），同时希望与其它取证重叠。公开 Sandbox API 只有前台的 `runCommand`、`runShell` 及其 `OrThrow` 版本，没有能启动后台命令、拿到句柄、再按超时与取消信号等待退出码和输出的入口，也没有说明同一 Sandbox 上能否同时有多条命令在途、单条命令是否有时长上限。

下游 NiceEval-Eval 的 `evals/harness/trace/concord-rsi/eval.ts` 因此自写了一套：root 私有目录里 `timeout … &` 分离启动、原子写状态文件、外层定时 `runShell` 轮询。2026-11-21 Attempt `@1RAPYNHEY5KWM` 的 timing 显示这套轮询在一次验证中发出 252 条 sandbox 命令，累计约 96 秒 SSH 往返；退出码、输出透传、超时与取消都要 Eval 作者自己保证。

## 期望

Sandbox 提供公开的后台命令能力：启动后返回句柄；可带超时与 `AbortSignal` 等待其退出码、stdout 与 stderr；Attempt 收尾时由 NiceEval 负责终止与回收；文档写明同一 Sandbox 并发命令的语义与 Provider 的时长上限。

## 影响

长验证类 Eval 只能手写分离与轮询，易错（漏 kill、状态文件竞争、取消不传递），并带来额外的往返耗时；同类需求会在每个下游重复实现。

## 来源

NiceEval-Eval dogfooding，2026-11-21，worker 报告 `judge-latency`；证据来自公开 `show @1RAPYNHEY5KWM timing --json` 与随包 Sandbox 参考、`niceeval sandbox --help`。

契约已定：[操作 Sandbox · 后台命令](../feature/sandbox/library/operations.md#后台命令)。
