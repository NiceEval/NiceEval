---
format: concord.document/v1
id: budget-probe-starves-global-semaphore
title: budget-probe-starves-global-semaphore
createdAt: 2026-07-11T17:22:54+08:00
createdAtSource:
  kind: first-recorded
  path: memory/budget-probe-starves-global-semaphore.md
  commit: d4c028b2170394e3e09fecc892334ac3111d773a
description: 有 budget 的实验曾把 budget
  探测循环包在全局并发信号量里面攥着槽位空等;修完之后发现探测循环本身(预测性节流)就是未文档化的多余设计,已整个删掉,budget 改成只按已完成花费判断
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
    statement: '**第一层根因(已修,commit `a3ace40`)**:`src/runner/run.ts` 里,「要不要开始跑」的
      budget 探测(还没拿到第一个真实成本样本前,同一实验只放 1 个 attempt 真正开跑,其余轮询等待,防止预算被穿)被写在了全局信号量
      `globalSem.withPermits(1)(body)` **里面**——即 `body` 的第一段就是这个轮询循环。于是一个
      attempt 先从全局 8 个槽位抢到 1 个,然后发现"轮不到我,得等",就攥着这个全局槽位死等而不释放。没设 `maxConcurrency`
      的实验(9 个 attempt 一拥而上抢全局槽位)加上有 budget 的实验一起占坑,槽位很快被"占着不干活"的 attempt
      占满,排在后面的实验一个槽位都抢不到。第一版修法:把 body 拆成 preflight(budget 探测 + 首过即停判断,不持有
      globalSem)和真正执行段(只有这段套 globalSem)。'
    proof: []
    source:
      path: memory/budget-probe-starves-global-semaphore.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:4192849b633c07b94f3032be84c7019bdaddb45a1f9a656fbc7d925447e3490a
---

现象:一个 e2b 实验批(5 个实验、`maxConcurrency: 8`、部分实验带 `budget`)实测同时只有 3 个 attempt 真正在跑,排在后面的实验(`codex-e2b--mempal`、`codex-e2b`)全程 "waiting for a slot",一个 attempt 都起不来——看起来像并发设置错了,实则是调度 bug。

**第一层根因(已修,commit `a3ace40`)**:`src/runner/run.ts` 里,「要不要开始跑」的 budget 探测(还没拿到第一个真实成本样本前,同一实验只放 1 个 attempt 真正开跑,其余轮询等待,防止预算被穿)被写在了全局信号量 `globalSem.withPermits(1)(body)` **里面**——即 `body` 的第一段就是这个轮询循环。于是一个 attempt 先从全局 8 个槽位抢到 1 个,然后发现"轮不到我,得等",就攥着这个全局槽位死等而不释放。没设 `maxConcurrency` 的实验(9 个 attempt 一拥而上抢全局槽位)加上有 budget 的实验一起占坑,槽位很快被"占着不干活"的 attempt 占满,排在后面的实验一个槽位都抢不到。第一版修法:把 body 拆成 preflight(budget 探测 + 首过即停判断,不持有 globalSem)和真正执行段(只有这段套 globalSem)。

**第二层根因(已修,同日追加)**:即便探测循环挪出了 globalSem,它本身仍然会把「同一 budgetKey、还没出第一个成本样本」的并发摁到一个很小的数——而 `defineExperiment` 的 `budget` 字段文档(`docs-site/zh/guides/write-experiment.mdx`)自始至终只写了一句「这一格配置的预算上限」,从没承诺过它会限制并发。用真实跑过的 dev-e2b 成本数据核对(下游 coding-agent-memory-evals 仓库的 `estimatedCostUSD` 普遍 $0.007~$0.37,9 个 eval 加总远低于 `budget: 2`)也证实:budget 富余的场景下,这层预测性节流纯粹是无谓的冷启动延迟,不是防超支必需品。

**最终形态**:budget 护栏整个简化成「只看已完成 attempt 的实测花费,到顶就跳过新 attempt,没到顶就立即放行」——删掉预扣循环、`inflight`/`costSamples` 字段、`Effect.sleep` 轮询。代价是「已花 + 在飞未结算」的总花费可能短暂超出 budget(在飞的不会被中途打断),这是有意选择的取舍:budget 是防止无限烧钱的安全网,不是精确计费闸,不应该反过来限制吞吐。`BudgetState` 现在只剩 `{ spent, completedNoCost, unenforceableWarned }`。

**Why 值得记**:
1. 这类"持有 A 锁等 B 锁放行"的死锁式占位 bug,表现极像"并发配置错了"(实测卡在固定的小数字上),排查时容易先怀疑 `maxConcurrency`/e2b 账户配额,而不是怀疑调度代码本身——与 [[e2b-sandbox]]、[[experiment-maxconcurrency-was-global-clamp]] 是同一类"并发数字诡异"陷阱,但根因完全不同,要先看代码再改配置数字。
2. 修完第一层之后不要停:同一个字段如果实现比文档承诺的语义"聪明"(这里是隐含限流),多出来的那部分聪明本身可能就是 bug 而不是特性——去比对文档/真实成本数据,而不是默认"实现更保守=更安全"。
