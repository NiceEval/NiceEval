---
format: concord.document/v1
id: failure-class-carry-on-turn-failed-has-no-error
title: 终局失败的 scope 怎么走出重试执行体:turn-failed 形态没有错误对象可挂
createdAt: 2026-07-24T19:11:20+08:00
createdAtSource:
  kind: first-recorded
  path: memory/failure-class-carry-on-turn-failed-has-no-error.md
  commit: 5e970c93505666d064f0522ec05ab873cd33b128
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [failure-class-carry-on-turn-failed-has-no-error](failure-class-carry-on-turn-failed-has-no-error.md) — 终局失败的 scope 要走出重试执行体:`turn-failed` 形态没有错误对象可挂(错误到 `expectOk()` 才铸造),且耗尽摘要会换出一个新的 Turn 对象——按 Turn 身份登记时登记错对象会让 scope 静默丢失、只在「重试耗尽」这条路径上错;修法=onFinalFailure 回执报浮出的那个 Turn + WeakMap 登记 + expectOk 附着;接线方注意 attempt.ts 转 AttemptError 时原错误即被丢弃"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 终局失败的 scope 怎么走出重试执行体:turn-failed 形态没有错误对象可挂

- **现象**(实现 `plan/runner-dispatch-spine-refactor.md` B3 时踩到):止损闸要在 attempt 封口读终局失败的 `FailureClass.scope`,但 `send` 失败有两种形态,只有一种能挂东西。`thrown` 形态可以把分类标在错误对象上(`failureClassOf` 沿 cause 链读得到);`turn-failed` 形态浮出的是一个 `Turn`——它此刻还不是错误(作者不调 `expectOk()` 就不算失败,attempt 可能照常判定通过),错误要到 `expectOk()` 才铸造。分类如果只在 `send-retry.ts` 里算完就丢,scope 静默消失、闸永远落不下,且没有任何报错。

- **第二层坑**:退避耗尽时会给失败 Turn 追加重试摘要,而那是不可变更新——`appendToLastErrorEvent` 产出的是**一个新的 Turn 对象**。若按 Turn 身份登记分类(WeakMap),登记 pre-suffix 的那个 Turn,调用方拿到的是 post-suffix 的那个,查不到、静默退化成缺省 `attempt` 档。恰好只在「重试耗尽」这条路径上错,单跑不重试的用例全绿。

- **根因**:分类是框架决议出来的旁路数据,而它要附着的载体在两种形态里生命周期不同;把「谁负责携带」想成一件事就会漏掉其中一条路径。

- **修法**(`src/context/send-retry.ts` + `session.ts` + `context.ts`,commit `9497ce3f`):
  - `SendRetryDeps.onFinalFailure(cls, failure)` 只在终局失败时回调(被重试吸收的不回调,scope 天然到不了闸),且**报的必须是浮出的那个 Turn**(耗尽路径传 `withSuffix ?? failure.turn`);
  - `SessionManager` 用 `WeakMap<Turn, FailureClass>` 登记,`resolveTurnFailureClass(turn)` 给 `makeTurnHandle`,`expectOk()` 铸造 `TurnFailed` 时用 `attachFailureClass` 挂上;
  - `thrown` 形态直接 `attachFailureClass` 到浮出的错误(不可枚举字段,不进 JSON;抛出点自己声明过的分类不覆盖)。

- **接线方还要注意**:`src/runner/attempt.ts` 的 catch 把错误转成纯数据 `AttemptError{code,message,phase}`,原错误对象在那一步就被丢掉——止损闸要读 scope,必须在这次转换**之前**(或就地)调 `failureClassOf(e)` / `resolveAttemptFailureClass(...)`,晚一步就没有载体了。
