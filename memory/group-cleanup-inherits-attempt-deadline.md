# Sandbox cleanup 命令继承已耗尽的 Attempt deadline

## 现象与根因

Group 的最后一条 Attempt 耗尽执行时限后，physical cleanup 虽然取得新 signal 和独立 30 秒 callback 预算，provider 仍保留租借时设置的 Attempt deadline。未显式指定 timeoutMs 的 checkpoint 命令经 commandLimit 将过期 deadline 钳制为 1ms，保存失败。

静态调用链为 runner/sandbox-pool.ts 的 lease → sandbox/runtime.ts 的 runTeardownHooks → sandbox/deadline.ts 的 commandLimit。单独替换 AbortSignal 不会替换 provider 的命令计时器。

## 修正

在每个 physical teardown callback 真正开始时，用 applyCommandDeadline 将 provider 截止时刻切换到当前时刻加 CLEANUP_TIMEOUT_MS；callback 直接使用 cleanupCallback 的 signal。Sandbox Plugin teardown 遵守相同边界。显式命令 timeoutMs 的优先级不变；失败仍记录诊断并继续 provider finalizer。

## 验证边界

公开 owner 为 e2e/runner/test/group-checkpoint-deadline.test.ts。真实 Docker fixture 在写入 second 后等待 Attempt signal 到期，避免用超时命令提前销毁 container；cleanup 先执行无显式 timeout 的 checkpoint，再验证显式 100ms timeout。

修复前预期失败点是 checkpoint 文件缺失；修复后预期保存 second，同时显式 timeout 仍生效。当前任务禁止本地 pack 和正式 E2E，红灯、转绿与 reliability takeover 均待 CI。源码修正和 typecheck 不能替代该证据，不能据此 resolve fixed。
