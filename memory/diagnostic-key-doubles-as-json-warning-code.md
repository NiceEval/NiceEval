# 诊断的去重 key 被当成 `--json` 的 `warning.code` 直接透出

## 现象

`--json` 事件流里 `warning` 事件的 `code` 字段不是 cli.md 承诺的稳定字面量,而是编进了身份的复合串:

```json
{"event":"warning","code":"lock-taken-over:compare/codex|memory/retention","level":"warning","message":"…"}
```

消费方没法按 `code === "lock-taken-over"` 分支——这个值每次运行、每条用例都不同。同一条诊断落
`snapshot.json` 时反而是干净的 `"lock-taken-over"`(持久化通路 `recordExperimentDiagnostic` 的
`code` 参数是独立传的),两条通路对同一件事说了两个词。

顺带的两个缺口:运行级诊断(实验闸 / eval 闸)不属于任何单条 attempt、不该伪造 `identity`,而
`json.ts` 只从 `event.identity?.experimentId` 取身份,于是止损闸的 `warning` 连 `experimentId` 都没有;
`WarningEvent` 也没有 `evalId` 槽位,eval 闸的 `data.evalId` 只有 `snapshot.json` 侧看得到。

## 根因

`DiagnosticInput` 只有一个 `key` 字段,同时承担两件不该合并的事:

1. **折叠粒度**——「这条诊断折叠到多细」(每实验一条?每用例一条?),所以必须把身份编进去;
2. **对外词法**——`--json` 的 `warning.code`、human 诊断行的标题,必须是可分支的稳定字面量。

`json.ts` 写 `code: event.key` 时把 1 当成了 2。这不是某个调用点写错,是类型上就没给 2 留位置——
所有把身份编进 key 的诊断(`lock-taken-over` / `fail-fast` / `budget-unenforceable` /
`experiment-teardown-*` / `dispatch-halted`)全部中招,只是 `dispatch-halted` 落地时才被发现。

## 修法

`DiagnosticInput` / `DiagnosticNotice` / `DurableFeedbackEvent` 的 `"diagnostic"` 变体各加一个可选
`code`:`key` 继续只管折叠粒度,`code` 是对外稳定词法,省略时回落 `key`(折叠身份本就不进 key 的
诊断天生就是干净字面量,不必逐个补)。`json.ts` 与 `human.ts` 都改读 `code ?? key`。

身份改成「`identity` 优先,回落 `data` 的同名字段」,并给 `--json` 的 `warning` 补 `evalId`——运行级
诊断把 `experimentId` / `evalId` 放 `data` 是既有约定(budget 的 `data.experimentId` 就是这么走的),
不为闸另造第三条通路,也不为了让身份透出去而伪造一个 attempt 级 identity。

落点:`src/runner/feedback/sink.ts`、`src/runner/types.ts`、`src/runner/feedback/{coordinator,reducer,json,human}.ts`、
`src/runner/run.ts` 各调用点(节点 C3)。

当时留的两处遗留**均已闭合**(2026-07-24 复核):

- `src/sandbox/**`:`resolve.ts:126` 现在是
  `reportDiagnostic({ key: d.dedupeKey ?? d.code, code: d.code, … })`,`code` 与 `key` 各归各位
  (commit `2e53660f`「fallbackFeedback 补 code,别把复合去重串当稳定词法透出去」)。
- `src/cli.ts` 的 `assembleInvocationCompletion`:归类改按 `code`,不按 `key` 前缀——
  `const code = d.code ?? d.key.split(":", 1)[0]`,后面逐个比 `interrupted` / `budget-exhausted` /
  `fail-fast` / `dispatch-halted` / `reporter-error`(commit `eb1b05d8`)。同一改动一并修了
  `src/runner/feedback/eval-conclusions.ts` 里同形的 `fail-fast` 判定。原来那句「别顺手把身份从
  key 里摘掉」的告诫因此作废:记账不再依赖 key 的形状。

## 补漏:`src/runner/attempt.ts` 的调用点同样漏改(已修)

C3 只改了 `run.ts` 的调用点,`attempt.ts` 的 `recordDiagnostic` 转发 `reportDiagnostic` 时既没传
`code` 也没把 `phase` 放进 `data`,于是**全部 attempt 级诊断**(`ScopedFeedback.diagnostic` 的
唯一出口:sandbox provider、sandbox hook、eval setup/teardown、adapter)双双中招:

- 作者不传 `dedupeKey` 时 key 缺省成 `` `${code}:${encodeAttemptKey(identity)}` ``,`code` 缺席后
  human 标题与 `--json` 的 `code` 一起回落成 `memory-warmup-degraded:compare/codex|memory/x|1` ——
  正是本条目要防的那种值;
- `WarningEvent.phase` 对 attempt 级诊断恒缺席(json renderer 读 `event.data?.phase`,而调用点只
  透传作者的 `data`)。

修法:`reportDiagnostic({ code: input.code, …, data: { ...input.data, phase } })`。**框架的 `phase`
写在展开之后、压过作者的同名字段**——`WarningEvent.phase` 是 `LifecyclePhase` 闭集,取值只能由运行器
当前所处阶段决定;作者 `data` 是开放词表,让它盖住等于允许从 eval 代码里冒充阶段,与
`ScopedFeedback` 两个方法都不收 phase 参数是同一条纪律。

教训:给一个跨多处调用点的接口加字段时,`code?: string` 这类**可选**槽位不会在漏改的调用点编译报错,
只会静默走回落分支。加可选字段时要把调用点数出来逐个过,不能指望 typecheck 提醒。这一条同日在四个
调用点各撞一次,已单独复盘成
[optional-field-additions-need-call-site-census](optional-field-additions-need-call-site-census.md)。
