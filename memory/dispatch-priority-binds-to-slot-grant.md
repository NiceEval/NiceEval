---
format: concord.document/v1
id: dispatch-priority-binds-to-slot-grant
title: 瓶颈优先绑在「并发位分配」上，不是 fiber 创建顺序
createdAt: 2026-07-20T22:34:04+08:00
createdAtSource:
  kind: first-recorded
  path: memory/dispatch-priority-binds-to-slot-grant.md
  commit: 837bc3fadbf4e3987e323016cd616605e093728a
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---
# 瓶颈优先绑在「并发位分配」上，不是 fiber 创建顺序

**裁决（2026-07-20）**：`docs/runner.md`「派发顺序:瓶颈优先」的优先级作用点定义为**全局并发位的分配时刻**——每有一个位空出，发给当前等待集中轮次数最高的 attempt，「谁先开始等」不参与裁决。实验级 `maxConcurrency` 闸不参与这条纪律，先来后到即可（同 run 内 attempt 优先级相同，内部先后不影响总墙钟）。

## 现象与根因

真实运行（`niceeval exp compare/codex`，3 配置：无上限 baseline + 两个 `maxConcurrency: 1` 实验）里，带**实验级** setup 的 `codex-gpt-5.6-luna--nowledge` 十几分钟一个 attempt 都没起跑，而同为 `maxConcurrency: 1`、但 setup 挂在 **sandbox 级**的 `--mempal` 正常抢到了位。没有任何报错——它是「排上了但轮不到」，不是跑挂了。

根因是**契约自身不自洽**，不是实现走样：

- `docs/runner.md` 的**承诺句**把派发顺序定义成「fiber 抢占 permit 的顺序」「轮次越多越早占用并发位」；
- 同节的**机制句**却把这层限定成「一次性数组排序、不改变两级信号量本身」；
- `docs/feature/experiments/architecture.md` 的**不占并发位句**要求等待实验级 setup 的 attempt 不持有 permit。

后两条组合必然推翻第一条：只要一个 run 在请求并发位**之前**插了一段真实异步等待（实验级 setup），数组排序给它的先机就在这段等待里失效，它回来时队伍已被无 setup 的宽并发 run 排满。旧实现（`src/runner/run.ts` 的 rounds 排序 + `Effect.makeSemaphore` FIFO + setup 在 `globalSem.withPermits` 之外）逐字实现了机制句和不占位句，没违反任何一句 docs——所以这是设计 bug，不是实现 bug。

## 否决的方案

- **为 setup 中的瓶颈 run 预留并发位**：真实理由是**尾部风险**，不是「容量空转」——预留只在 setup 期间空掉一个位，而当瓶颈主导 makespan 时这段空转不在关键路径上，孤立看甚至可能降低总时长；否决它是因为 setup 耗时事先不可知、且可能失败（隧道冷启动重试、服务拉不起来），预留等于拿一个位押注一段无上界、可能白等的等待，失败时纯亏。backfill 的代价（一次、上界为单个 attempt 耗时的起步延迟）有界可预测，也不随 setup 失败放大。
  - 警告：初稿曾把否决理由写成「预留 = 容量 1:1 空耗」并声称 backfill 的等待上界「已是不可抢占调度的下界」，两句都错（预留是准入控制不是抢占；agent attempt 动辄数分钟，这个上界并不小）。定稿理由以本条为准。
- **抢占在飞 attempt**：已花的沙箱与 token 成本不可回收。
- **削弱承诺**（改口成「fiber 派生顺序」，承认 setup 会让出先机）：契约能自洽，但「瓶颈优先」在它最该生效的场景（慢 setup 的瓶颈实验与宽并发 baseline 混跑）恰好失效，等于设计目标名存实亡。

采纳的形态是批调度器的 backfilling：空位给最高优先级等待者，低优先级见缝插针；每个 attempt 只要一个位，不需要多资源预留式 backfill 的复杂度。额外等待上界 = 在飞 attempt 中最先完成那个的剩余耗时，每个实验整场只付一次。

**实现不能架在现有信号量上**：`globalSem` 是 `Effect.makeSemaphore`，获取语义是 FIFO，没有优先级钩子。这条纪律要求一个自定义的按优先级排序的等待队列 / 名额分发器（排序键 = rounds 降序 → run 发现顺序 → attempt 顺序），并保持中断安全、不破坏 `Effect.ensuring` 的 teardown finalizer。这是换核心原语，不是给排序打补丁。

## 落点

契约：`docs/runner.md`「调度:有界并发」+「派发顺序:瓶颈优先」两节重写，`docs/feature/experiments/architecture.md` 实验级生命周期的「不占并发位」条改为「不占并发位,也不折损优先级」，`docs-site/zh/explanation/runner.mdx` 并发节补用户视角一段。场景行登记在 `docs/engineering/testing/unit/experiments-runner.md` 并发分区（3 行：瓶颈优先分配 / work-conserving / 等待中被中止不泄漏名额）。实现未动，待按登记行先写红测试再改 `src/runner/run.ts`。

## 可复用的判据

一个调度承诺若表述为「谁先开始 X」，要先问 X 之前有没有可变长的异步段——有的话，承诺必须绑在**资源分配的时刻**，不能绑在**请求发起的顺序**上，否则这层优先级会在「前置耗时越长越该优先」的场景里反向失效。
