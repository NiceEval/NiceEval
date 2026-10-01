---
format: concord.document/v1
id: timeout-evidence-carry-censoring-ruling
title: 裁决:超时不丢证据、timeoutMs 退出指纹改携带判据、耗时删失显式呈现(2026-07-23)
createdAt: 2026-07-23T18:01:24+08:00
createdAtSource:
  kind: first-recorded
  path: memory/timeout-evidence-carry-censoring-ruling.md
  commit: fdab6dbcb9f18fec765b8714ea6d6405962f6745
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
# 裁决:超时不丢证据、timeoutMs 退出指纹改携带判据、耗时删失显式呈现(2026-07-23)

**裁决**(三条一揽子,起因同一个真机 case):

1. **超时不丢证据**:事件接收器 / usage 累计 / timing recorder 归属 attempt 外层 Scope,超时中断只终止 body fiber;超时 attempt 落盘与正常 errored 同构——events 保留截至中断的全部已归一化事件、usage 为已累计值、收尾段在 teardown 链前照常补折叠一次 workspace.diff(沙箱仍活着,「走到哪」正是超时最需要的证据)。不新增 StreamEvent 成员(见 [[streamevent-new-member-cascade]]),中断事实由 `error`(code="timeout", phase=中断时阶段)表达。
2. **`timeoutMs` 不进指纹哈希**,改为携带资格判据:终态 attempt 可携带当且仅当 `durationMs` ≤ 当前 resolved `timeoutMs`。提高上限不作废任何已完成结果(只有本就不携带的撞线 errored 重跑);调低上限时超线旧结果如实重跑。
3. **耗时删失**:`durationMs` 指标对 timeout attempt 返回 `null`(线值是右删失点非实测),删失经既有 samples/total 覆盖率机制显式可见;超时线选取纪律(远离自然耗时上沿、对固定协议开销条件不中立)写进 Runner · 超时。

落 docs:`docs/runner.md#超时双层保护`、`#缓存指纹去重`、`docs/feature/experiments/architecture.md` 调度接口、`docs/feature/reports/library/metrics.md`。实现 TODO 在 `plan/timeout-evidence-and-carry.md`。

**起因(MemoryBench 真机)**:react-datepicker/pr-6058 在 mempal 条件 20.0m 撞 `timeoutMs: 1200000` 硬线(baseline 9.8m / nowledge 12.7m 均 passed)。三连锁问题:① onTimeout 从 base 空壳重建结果,events/usage/diff 全丢,`show --execution` 只剩 "(no events recorded)",最需要证据的场景恰好零证据;② 配置注释写「与 claude 组对齐,消除条件间超时偏置」——对齐数值恰恰制造偏置:记忆条件每 attempt 背固定协议开销(开场 search + 收尾写笔记 + Stop hook 整轮),同一条线系统性先截断它们,且 baseline 最长题 18.7m 距线仅 7%,线压在分布上沿,测的是「谁先撞线」;③ 被截断样本从耗时统计消失,慢条件反而显得快(幸存者偏差),正打在 benchmark 要测的东西上。当时想提线到 40m,但 timeoutMs 在指纹里(src/runner/fingerprint.ts:47),一改 66 个已完成结果全部作废——这个代价本身就是裁决 2 要修的设计错误。

**曾选方案与否决理由**:

- 把 timeout 当 mempal 真实成绩(记忆开销做不完就是代价)——否决:只在「线远高于所有条件自然耗时」时成立,线压在分布上沿时测的是撞线序不是完成能力。
- timeoutMs 留在指纹、提线全量重跑——否决:为一个不影响已完成结果的参数付 66 次重跑,「结果是什么」与「等不等得到」被哈希强行绑定。
- durationMs 对 timeout 取线值参与均值——否决:把删失点当观测值,均值被上限参数污染;完全排除又是幸存者偏差,唯一诚实做法是 null + 覆盖率显式呈现。
