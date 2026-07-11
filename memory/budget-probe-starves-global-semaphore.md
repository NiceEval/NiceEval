---
name: budget-probe-starves-global-semaphore
description: 有 budget 的实验曾把 budget 探测循环包在全局并发信号量里面,攥着槽位空等,实测并发被压到远低于 maxConcurrency
metadata:
  type: project
---

现象:一个 e2b 实验批(5 个实验、`maxConcurrency: 8`、部分实验带 `budget`)实测同时只有 3 个 attempt 真正在跑,排在后面的实验(`codex-e2b--mempal`、`codex-e2b`)全程 "waiting for a slot",一个 attempt 都起不来——看起来像并发设置错了,实则是调度 bug。

根因:`src/runner/run.ts` 里,「要不要开始跑」的 budget 探测(还没拿到第一个真实成本样本前,同一实验只放 1 个 attempt 真正开跑,其余轮询等待,防止预算被穿)被写在了全局信号量 `globalSem.withPermits(1)(body)` **里面**——即 `body` 的第一段就是这个轮询循环。于是一个 attempt 先从全局 8 个槽位抢到 1 个,然后发现"轮不到我,得等",就攥着这个全局槽位死等而不释放。没设 `maxConcurrency` 的实验(9 个 attempt 一拥而上抢全局槽位)加上有 budget 的实验一起占坑,槽位很快被"占着不干活"的 attempt 占满,排在后面的实验一个槽位都抢不到。

修法:把 body 拆成 preflight(budget 探测 + 首过即停判断,故意不持有 globalSem,只被 runSem 罩着——runSem 是实验自己的资源,占着不影响别的实验)和真正执行段(只有这段套 `globalSem.withPermits(1)`)。已修在 `src/runner/run.ts`(commit `a3ace40 fix(runner): budget 探测循环不再占用全局并发 permit`),契约见 [[docs/sandbox.md]] 附近 `runner.md`(调度职责)。

**Why 值得记**:这类"持有 A 锁等 B 锁放行"的死锁式占位 bug,表现极像"并发配置错了"(实测卡在固定的小数字上),排查时容易先怀疑 `maxConcurrency`/e2b 账户配额,而不是怀疑调度代码本身——与 [[e2b-sandbox]]、[[experiment-maxconcurrency-was-global-clamp]] 是同一类"并发数字诡异"陷阱,但根因完全不同,要先看代码再改配置数字。
