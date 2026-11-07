# experiment maxConcurrency 曾是全局钳制:一个串行实验拖慢整批

## 现象

`ExperimentDef.maxConcurrency` 的公开文档(docs-site write-experiment)一直写的是
「这一格配置的并发上限」,但 ≤0.4.4 的实现是 CLI 取**所有选中实验设置值的最小值**去钳
全局并发。后果:实验组里只要有一个 `maxConcurrency: 1` 的实验(比如跨 eval 累积记忆态、
必须串行的 mempal 条件,或压 Vercel session 限额的实验),`niceeval exp <组>` 整批基线
全被拖成串行。下游(coding-agent-memory-evals)为绕开它在 agent setup/teardown 里
手写了模块级 per-stateKey promise 互斥锁。

## 根因

`src/cli.ts` 把 `selected.map(e => e.maxConcurrency)` 取 `Math.min` 后并进全局
maxConcurrency 解析链;runner 只有一个全局 `Effect.forEach({ concurrency })`,没有
按实验限流的通道——实现从没支持过文档描述的 per-experiment 语义。

## 修法

调度改**两级信号量**(`src/runner/run.ts`):`Effect.forEach` 本身 unbounded,执行体
先过实验级信号量(`AgentRun.maxConcurrency`,来自 `ExperimentDef.maxConcurrency`,
CLI 原样透传、不再 min 钳全局)、再占全局 permit(原 `opts.maxConcurrency`)。获取
定序恒为 runSem → globalSem,无环等待;等全局 permit 的实验级持有者不占其它实验的
并发位。等于/超过全局值的实验级设置不建闸。

适用判断:实验需要「自己串行但别拖累同批」时,直接 `maxConcurrency: 1`,不需要再在
setup/teardown 里手写锁;真正全局的限额(整个后端账号级并发)仍走全局 maxConcurrency
或 sandbox 推荐值,实验级闸帮不上。
