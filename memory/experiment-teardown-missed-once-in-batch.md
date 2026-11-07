# 实验级 teardown 在一次真实批跑中未触发(间歇,根因未定位)

**现象**(2026-07-17,coding-agent-memory-evals):`niceeval exp compare`(72 attempt,45 carry + 27 fresh,9 实验)正常跑完、exit 1(有 failed/errored,属正常 CI 语义)后,`compare/claude-dp-v4--nowledge` 的实验级 teardown 没有执行——mem 容器、cloudflared 隧道、实例数据目录全部残留(`nowledge-mem.sh down` 的 `rm -rf $STATE_DIR` 显然没跑过),也没有 `experiment-teardown-failed` 诊断(说明 `runExperimentTeardown` 要么没被调、要么调时 `cleanup` 已是 undefined)。手动执行同一条 `down` 秒过,脚本本身无问题。

**同一份代码下不能复现**:
- 单实验单 eval `--force`(1 fresh):teardown 正常(docker 观察器确认容器拆除)。
- 用户随后的全量 `compare`(57 carry + 15 fresh,human profile):teardown 正常(容器、实例目录、隧道全消失)。
- 单元复现(部分 carry + `maxConcurrency:1` 串行 + passed/errored 混合 + 双实验):通过。

**已排除的候选根因**:remaining 计数与 attempts 展开同源(carry 跳过的行两边都不计);preflight 跳过(early-exit / fail-fast / budget)路径 ensuring 同样递减;该批未命中任何跳过;fiber defect 会让 runEvals 抛错(没抛);ensuring 在 runSem 外层,中断/失败都执行;JS 单线程下 `remaining -= 1; if === 0` 无并发窗口;setup memoize 单实例(.cache 只有一个实例目录)。

**修法(兜底,非根治)**:`src/runner/run.ts` 在 `Effect.runPromiseExit` 结算、全部 fiber 与 finalizer 收尾之后,增加一道幂等扫尾:遍历 `expLifecycles`,对 `tornDown === false` 且仍持有 cleanup 的实验强制执行 teardown,并报 `experiment-teardown-late` warning 诊断(带 `remaining` 数据)。正常路径零影响;间歇现象再现时这行诊断就是定位探针——**看到它请把当次运行形状补进本条目**。若长期(数月)不再出现且无人看到该诊断,可复盘是否当初漏看了什么一次性环境因素(如进程被外部信号影响),再决定去留。

关联:[[experiment-level-lifecycle-hooks]](该机制的设计裁决)。
