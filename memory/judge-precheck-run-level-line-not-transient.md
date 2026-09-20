---
format: concord.document/v1
id: judge-precheck-run-level-line-not-transient
title: judge 预检定性为运行级生命周期行,不是「运行级瞬时通知」
createdAt: 2026-07-24T09:37:03+08:00
createdAtSource:
  kind: first-recorded
  path: memory/judge-precheck-run-level-line-not-transient.md
  commit: fce3f25e92fd4e6dd803958036ddf27b7781e522
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
# judge 预检定性为运行级生命周期行,不是「运行级瞬时通知」

## 现象

真机跑 `niceeval exp install/canary install/db-gpt` 时面板长时间停在
`1 total · 0 reused · 0 running · 1 queued · 0 completed`,像调度卡死。根因不是调度:

- 计数框在 `coordinator.start(plan)`(真正派发前)就预置成 `queued = total - reused`,
  只有 `attempt:start` 才把 attempt 从 queued 移进 running(`reducer.ts`)。
- 卡点是 judge 预检——`run.ts` 在 `Effect.forEach` 调度**之前**同步 `await probeJudge(jc, signal)`
  (`src/scoring/judge.ts`)。实测判分网关 `x1api.top` 对一个最小探测请求要 ~14s 才回;
  `probeJudge` 的 `fetch` **没有超时**,唯一 signal 是 Ctrl+C,网关若接受连接但不回就永久挂。
- 期间只有一行 `prechecking judge config...` 在 scrollback、下面的框冻在 `1 queued`,
  没有任何东西说明「正卡在预检」。

## 根因(设计)

judge 预检原本在 `docs/feature/experiments/cli.md` 里被归为「运行级**瞬时**通知」——契约只承诺
追加一行、`--json` 不输出,前提是它一闪而过。但它其实是一次真实网络往返,可以阻塞十几秒甚至更久,
「瞬时」这个定性没为「它会慢/会 block」准备任何进度反馈。

## 修法(设计裁决,2026-07-24)

判分预检从「瞬时通知」**升格为运行级生命周期行**,与实验级 setup/teardown 同一显示类:

- 预检期间 live 面板 ACTIVE 区显示一行 `● prechecking judge config   <elapsed>`,排在实验钩子行与
  attempt 行之前(它发生在最前,是「为什么 attempt 还停在 queued」的解释);存活性由持续增长的
  elapsed 证明(不做 spinner,与 attempt 行同一约定),预检结束即消失、不进 scrollback。非 TTY /
  `--json` 起止各一个永久事件(`judge_precheck` started/done)。
- 不复用 experiment-hook 通道(那会伪造 experimentId):新增 invocation 级 `precheck`
  `DurableFeedbackEvent` 变体 + `RunFeedbackState.activePrecheck` 单一在飞项。落点:
  `src/runner/types.ts`(事件+状态)、`feedback/reducer.ts`(set/clear,不动计数不变量)、
  `feedback/human.ts`(ACTIVE 行 `formatPrecheckRow` + TTY appendDurable 跳 scrollback)、
  `feedback/json.ts`(`judge_precheck` 事件)、`feedback/sink.ts`+`coordinator.ts`(`reportPrecheck`)、
  `run.ts`(探测循环包 started/done)。删掉旧 `runner.judgePrecheck` i18n key。

反直觉点:`formatPrecheckRow` 的 label **不能**像实验钩子行那样 padTrunc 到身份列宽——预检恒是
单独一行(此刻没有 attempt/hook 行),那时身份列还压在初始最小值,会把标签截成 `p…`;直接用整行宽度。

## 探测超时(已补,2026-07-24)

同批给 `probeJudge` 的 `fetch` 加了 20s 上限(`src/scoring/judge.ts` 的 `PROBE_TIMEOUT_MS`):
`AbortSignal.timeout(20_000)` 与外层 signal(Ctrl+C)经 `AbortSignal.any` 合流。超时源触发时抛的
错误 `name === "TimeoutError"`,据此报专门的 `judge.probeTimeout`(「端点接受连接却不回,检查
baseUrl / 网关」),而不是把通用 abort 甩给用户;其它探测失败仍走 `judge.probeFailed`。20s 是
「足够慢但能用的网关回一个最小请求、又不至于让真挂死无限等」的取舍——起因正是 x1api.top 单次探测
~14s。相关:[[judge-config-precheck-hard-fails-without-key]](缺 key 硬失败,这里是可达但慢/挂)。

## 副作用台账

新增 `DurableFeedbackEvent` 变体会炸穿两处穷尽 switch:`coordinator.ts` 的 `fallbackTextFor`
与 `json.ts` 的事件分发(human 的 `renderDurableLines` 有 default 但要补非 TTY 行);
`FeedbackSink` 接口加方法会让所有测试里的 fake sink 字面量编译失败,补 `precheck() {}` no-op。
