---
format: concord.document/v1
id: e2b-command-stream-waits-for-detached-service
title: e2b-command-stream-waits-for-detached-service
createdAt: 2026-08-02T15:18:14+08:00
createdAtSource:
  kind: first-recorded
  path: memory/e2b-command-stream-waits-for-detached-service.md
  commit: 0d24186331cc787226bccdc99c515ff8b7f331a6
description: E2B commands.run 的 wait 把直接 shell 退出与 stdout/stderr event stream
  EOF 绑定，nohup 后台服务继承输出管道会让正常任务永不 settle
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [e2b-command-stream-waits-for-detached-service](e2b-command-stream-waits-\
      for-detached-service.md) — E2B `commands.run` 把 shell 退出和 stdout/stderr
      EOF 绑死，`nohup ... &` 继承管道令任务永不 settle；修为直接 shell completion marker 后只断
      transport，异常仍退休 VM"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象（2026-08-02，真实 Terminal-Bench `fibonacci`）**：官方解法在最后启动
`nohup uv run /app/server.py &` 后正常返回；E2B 的 `commands.run()` 却持续等待后台服务继承的
stdout/stderr 管道关闭。Attempt 不是任务失败，也不是 command timeout，而是正常 shell 已退出后仍不
settle，导致 oracle 无法进入判分。

**根因**：E2B `CommandHandle.wait()` 的完成条件包含 event stream EOF，不能单独代表入口 shell
已退出。直接在普通前台 `commands.run()` 上等待，会把 Case 有意留下的任务服务误当作当前 shell
的一部分；用 `kill()` 解除等待又会错误杀掉服务。

**修法**：`src/sandbox/e2b.ts` 将每条 shell 放进只承接其退出码的 supervisor。supervisor 在直接
shell 结束后向 stdout/stderr 分别写入带随机值的 completion marker；两路 marker 到齐即返回已采集的
前台 stdout、stderr 与 exit code，并调用 `CommandHandle.disconnect()` 只断 event transport，不杀
后台服务，也不重定向它的输出。若 E2B command timeout、signal 取消或 Attempt interruption 发生，仍
按公共命令树协议 `kill()` 整台 VM，禁止未确认终止的命令树进入 reuse / keep。

**守护**：`src/sandbox/e2b.test.ts` 模拟 `wait()` 永不 resolve 的 handle 和持续存活的后台服务，分别
跨 chunk 送入 stdout/stderr marker；断言直接 shell 退出即得到完整前台输出和非零 exit code、只调用
`disconnect()`、不调用 sandbox kill。类型检查确保 command handle 的 background / disconnect 路径仍与
当前 E2B SDK 签名一致。
