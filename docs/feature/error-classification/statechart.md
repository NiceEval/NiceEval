# 发送退避与并发名额的状态

一次可重试的 send 失败后，Attempt 退避等待再重发。这期间全局名额归还，Experiment 名额与独占 Sandbox 通道仍由原 Attempt 占着，见[重试](architecture.md#重试)。退避、等待与另一条 Attempt 的派发交错时，单看每次取得和归还都配对，跨层却可能超限或互相等待。这一页用模型检查器核对这些规则。

## 规则

### 全局名额不超限 {#GlobalBound}

同时持有的全局名额不超过并发上限；等待重试时归还全局名额。

### Experiment 名额贯穿 Attempt {#ExperimentBound}

已开始且未收尾的 Attempt 在退避期间仍计入所属 Experiment 的并发上限。

### 独占通道只服务一条 Attempt {#LaneBound}

同一独占 Sandbox 通道同一时刻只服务一条 Attempt，退避期间仍由原 Attempt 使用。

### 就绪的 Attempt 最终收尾 {#Progress}

有限批次中依赖会结算、可运行的步骤得到调度时，每条已就绪的 Attempt 最终收尾。

## 模型

```statechart spec="./tla/after-shared/Scheduling.tla" config="./tla/after-shared/after-shared.cfg" view="./tla/scheduling-view.ts" out="./tla/after-shared/out/after-shared" digest="sha256:eebe3a8ab0de8dc9ad4957c7658f5be0be2b4a89085c5b063fe8f62e7fa5fdb4"
```

```statechart spec="./tla/after-exclusive/Scheduling.tla" config="./tla/after-exclusive/after-exclusive.cfg" view="./tla/scheduling-view.ts" out="./tla/after-exclusive/out/after-exclusive" digest="sha256:b6b3f4ed457d22a6610abea1ada4ebf41d69fff17fbfc9a9599299af1c4bcaa0"
```

```statechart spec="./tla/after-mixed/Scheduling.tla" config="./tla/after-mixed/after-mixed.cfg" view="./tla/scheduling-view.ts" out="./tla/after-mixed/out/after-mixed" digest="sha256:98947c1177bd31f922734ac3e7316a7da715604c42ef4e775eae84223137eed0"
```

全局上限 2、Experiment 上限 1。三块依次是：两条 Attempt 共用 Provider；两条 Attempt 争同一独占通道；两个 Experiment 的四条 Attempt 争同一独占通道（状态数超过图的规模上限，只显示检查报告）。四条规则都成立。

只建模一次已知未受理的失败与一次重发；受理证据、每个 send 四次与每个 Attempt 八次的预算、deadline、取消与按范围止损没有模型状态，由 `test/integration/turn-retry-budget.test.ts` 覆盖。

## 按路径重放的测试

- `test/integration/experiment-backoff-tla-repro.test.ts`：退避曾归还 Experiment 名额，同一 Experiment 的第二条 Attempt 插进第一条的两次发送之间；独占通道下两条 Attempt 曾互相等待。
- `test/integration/experiment-halt-exclusive.test.ts`：Experiment 止损后，排在独占通道队列里的 Attempt 曾仍开始发送；现在止损后不再派发。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 取得 Experiment 与全局名额、派发 | `runner/run.ts` |
| 独占通道 | `runner/run.ts` 为每个通道建容量为 1 的许可 |
| 未受理、退避、重取全局名额并重发 | `context/send-failures.ts`；`context/send-retry.ts`；`context/session.ts` |
| 收尾并归还名额 | `runner/run.ts` |

## 模型没有覆盖的部分

准备链、派发首波、execution claim、Provider provisioning 与清理故障。
