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

## 复盘与二次修法(2026-07-18,commit 14e5207)

第一版三件套仍留了两个洞,真机再次复现孤儿容器后定位:

- **窗口与预算倒挂**:强清等 `runInFlight` 的固定窗口 15s < 单个收尾可调用体的合法预算 `CLEANUP_TIMEOUT_MS`(30s)——一个合法的实验级 teardown(probe+down)还没跑完就被 `process.exit` 拦腰砍断。数字孤立手写、没有从常量推导,是漂移的直接来源。
- **在飞收尾对兜底不可见**:`runExperimentTeardown` 的同步一次性交换把 closure 从 `lc.cleanup` 取走后,注册表 drain 只能空转——最常见时序(sweep 已在跑 teardown 时二次 Ctrl-C)下兜底恰好失效。

二次修法(与生命周期成对化联动,见 [lifecycle-paired-teardown-replaces-cleanup-return](lifecycle-paired-teardown-replaces-cleanup-return.md)):

1. teardown 执行体改为 **memoized 一次性 promise**(`lc.teardownPromise`),注册表条目 settle 后自注销——drain 语义变成「启动全部未启动 + 等待全部未 settle(含在飞)」,兜底不再空转;登记时机提前到触发时点,setup 挂起/抛错也不丢收尾。
2. 强清退出条件从「时钟窗口到点」改为**事件驱动 settle**:强停沙箱后并发等「在飞收尾链 settle」与「注册表排空」,两者 settle 即退;兜底上限 `2 × CLEANUP_TIMEOUT_MS` 直接从常量推导,docs/cli.md 声明不等式链(provider stop 8s < 看门狗 12s < 30s ≤ 60s),只拦可调用体绕过自身超时的失守病态。

教训:「有界窗口等得起」这类论证必须真的比较两个数——上界存在 ≠ 窗口 ≥ 上界;固定时钟 race 不可观测的在飞工作,取什么数都不对,正确形态是让在飞工作可等待、事件驱动收口。
