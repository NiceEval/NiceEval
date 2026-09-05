---
format: niceeval.memory/v1
id: fs-promise-watch-starts-on-iteration
title: 文件 ready 屏障应先开始监听再检查状态
createdAt: 2026-09-05
kind:
  type: insight
  state: current
promotions: []
---
`node:fs/promises.watch()` 返回惰性的异步生成器；调用本身不会开始监听。先创建 iterator，再次 access，再进入 for-await，仍然可能漏掉在第二次 access 与首次 next 之间发布的 ready 文件。

本轮对 Lifecycle 的原始等待函数注入同一外部文件发布时间，旧函数在文件已存在时仍等到 process-exit，新函数立即接收 ready。修正使用同步启动的 `node:fs.watch()` callback API，再检查已存在状态，并在 ready、process exit 或 watcher error 后关闭 watcher。fixture 的 readiness 文件也必须在其 journal evidence 完整写入后发布。

PR #222 首轮 CI 的 Incus prefix DAG 用例超时，本地原候选同用例通过；以上实验证明了一个真实等待漏洞，但不能单独证明它是那次 CI 超时的唯一原因。用例现在在失败时附带已启动 child branches 与 ready 状态，以区分 provider 未到达屏障和父进程漏通知。
