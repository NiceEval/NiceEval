# 强杀(SIGKILL)反复漏实验 teardown:孤儿容器 + license 席位泄漏,且无事后清理入口

## 现象

2026-07-21,在 `/Users/ctrdh/Code/coding-agent-memory-evals` 用后台任务跑 nowledge 三方对照(2.5h 串行 run)。宿主的后台任务有 ~1h 硬寿命上限(外部看门狗,`caffeinate` 已排除休眠因素),run 反复被强杀:

- 实验级 teardown(`nowledge-mem.sh down`,关掉持有 license 席位的外部记忆服务)从未执行,每次重跑再起一份服务,席位随重跑累积泄漏,只能多次手工 `nowledge-mem.sh down`。
- Docker 孤儿容器残留,niceeval 没有任何命令能发现或收回它们,只能手工 `docker ps -a` + `rm -f`。
- 已完成 attempt 的结果没有声明的续跑语义,1h 内跑不完的 run 等于白跑。

## 根因

进程内的三级响应(`docs/cli.md`)覆盖 SIGINT/SIGTERM/崩溃,SIGKILL 下没有任何代码来得及执行——这是物理边界,不是 bug。真正的缺口是契约只写了「Docker candidate label 与云 provider TTL 留作事后核对」,但「事后核对」没有落成任何机器动作:label 不带属主信息无法区分孤儿与并发 run;实验收尾义务只活在进程内注册表(`experiment-cleanup-registry.ts` 的 memoized promise),进程死义务即消失;携带(carry)契约未声明 attempt 粒度与未收尾快照是否参与。

## 修法

设计定稿于 2026-07-21(契约先行,实现见 `plan/hard-kill-recovery.md`),三面兜底:

- **实例面**:创建期把运行标识(`host`/`pid`/`startedAt`)写进 docker label / e2b metadata;`niceeval sandbox list --orphans` + `sandbox prune` 事后核对与收回(`docs/feature/sandbox/architecture.md` 孤儿核对节)。
- **实验面**:收尾登记随触发时点落盘 `.niceeval/teardowns/`,重跑启动自愈(先补 teardown 再 setup),手动入口 `niceeval exp <experiment> --teardown`(`docs/feature/experiments/architecture.md` 强杀后的收尾兜底节)。
- **续跑面**:携带细化为 attempt 粒度、未收尾快照参与携带——重跑同一条命令就是续跑(`docs/runner.md` 缓存节)。

关键裁决(否决方案):

- 不做「拦截 SIGKILL」或 supervisor 进程——物理上做不到 / 引入第二个要管生命周期的进程,兜底全部建立在「创建期写归属 + 事后认领」上。
- 实验收尾恢复不进 `sandbox` 命令组——该命令组「不执行用户代码」是硬边界,teardown 是用户代码,恢复入口挂在本来就加载实验模块的 `exp` 上。
- 孤儿判定偏保守:pid 探测不到属主才杀,异宿主/不可核对一律 `unverified` 不自动销毁——误杀活实例的代价高于多留一台。
- vercel 不参与孤儿核对(SDK 无按元数据检索通道),TTL 兜底,契约如实声明差异而不是伪装全 provider 一致。

## 适用场景

任何外部看门狗强杀 runner 的环境:CI 时限、宿主超时、后台任务寿命上限。附带教训:AI 助手的后台任务有 ~1h 硬寿命,超过 1h 的 eval run 要么拆批、要么依赖上面的续跑语义,不要指望单次后台任务跑完。
