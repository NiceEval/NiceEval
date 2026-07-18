# 强清退出路径跳过实验级 teardown(Ctrl-C 后反激活没跑)

## 现象

在 coding-agent-memory-evals 真机跑 `niceeval exp compare`(e2b + nowledge 实验)时 Ctrl-C 中断,实验级 teardown(nowledge mem 实例的反激活:拆容器 + 隧道)没有执行,mem 实例留成孤儿要手拆。scrollback 只有一行 `! sandbox-force-cleanup · [sandbox] force-cleaning 1 sandboxes...` 后进程就退了(2026-07-18)。复现:e2b 批跑中 Ctrl-C——优雅停沙箱超过 12s 触发看门狗、或用户连按两次,都会进强清路径。

## 根因

`cli.ts` 的强清退出(`forceCleanupAndExit`:二次 Ctrl-C / 12s 看门狗)只做 `coordinator.stopDynamic()` + `stopAllSandboxes()` 就 `process.exit(130)`:

- 实验级 cleanup 活在 `runEvals` 局部的 `expLifecycles` Map 里,cli 层完全够不到,进程退出把在飞的优雅收尾链(attempt 级 teardown + 实验级扫尾)连同 fiber 一起杀掉;
- `main().catch()` 崩溃路径同样只兜沙箱;run.ts 的收尾扫尾原本排在「真缺陷 throw」之后,缺陷路径也不会执行;
- 更深一层:收尾链各可调用体没有超时(`measureClosing` 只计时),docs/cli.md 声称的「各 teardown 自己另有清理超时」当时未兑现——优雅路径可被一个挂起的钩子无限拖住,把用户逼向强清,而强清又跳过一切 teardown。

## 修法

裁决「所有 teardown 都应该跑」,强清语义改为**加速收尾而不是绕过收尾**(docs/cli.md「中断:三级响应」重写),三件套:

1. **宿主机侧注册表** `src/runner/experiment-cleanup-registry.ts`(与 `sandbox/registry.ts` 同模式):setup 完成时登记 teardown 闭包,正常路径消费即注销,`drainExperimentTeardowns()` 一次性排空;双跑防护靠 `runExperimentTeardown` 内同步一次性交换 `lc.cleanup`,不靠注册表。
2. **强清顺序重排**(`src/cli.ts`):`stopAllSandboxes()`(让卡在沙箱 I/O 的收尾立刻失败返回)→ 有界等 `runEvals` 收口(15s,`runInFlight` 句柄)→ `drainExperimentTeardowns()` 兜底 → exit。`main().catch()` 崩溃路径同样 drain;`run.ts` 真缺陷 throw 前先扫尾(`sweepExperimentTeardowns` 提到 throw 之前)。
3. **收尾可调用体逐个 30s 超时** `src/runner/cleanup-timeout.ts`:eval/agent/sandbox 各段 cleanup 与钩子、实验级 cleanup 共用 `withCleanupTimeout`,到点按该段既有失败语义收束(`teardown-failed` / `experiment-teardown-failed` 诊断),兑现 docs 的有界性声明——这是「强清等得起收尾链」的前提。

适用场景:任何「进程退出路径绕过 Effect fiber 内 finalizer」的资源清理;新加宿主机侧长驻资源时应同样登记进独立于 Effect 的注册表。

关联:[experiment-teardown-missed-once-in-batch](experiment-teardown-missed-once-in-batch.md)(计数路径间歇失灵的兜底扫尾,是本条修法 2 的前身;本条把扫尾进一步扩到缺陷 throw 路径与进程强清路径)。
