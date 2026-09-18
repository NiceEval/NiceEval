---
format: concord.document/v1
id: data-shape-validator-deepening-forward-compat-kind
title: data-shape-validator-deepening-forward-compat-kind
createdAt: 2026-07-20T09:39:41+08:00
createdAtSource:
  kind: first-recorded
  path: memory/data-shape-validator-deepening-forward-compat-kind.md
  commit: 496974edc5136db605516115c26363165e6b24ad
description: 深化 validate*Data 判别联合时两种反方向的坑——ScopeWarning 未登记 kind 要放行（validator
  曾太严）、TraceSpan 字段被 fixture 的 as never 偷懒绕过（validator 是对的，该改 fixture）
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
    statement: "- 已修
      [data-shape-validator-deepening-forward-compat-kind](data-shape-validator\
      -deepening-forward-compat-kind.md) — 深化 `validate*Data`
      判别联合炸出既有测试时两种反方向的坑:`ScopeWarning` 未登记 kind 要放行(validator 曾太严,改
      validator);`TraceSpan` 字段被两处 fixture 的 `as never` 偷懒绕过(validator 是对的,改
      fixture);判断法与两个真实案例见正文"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

## 现象

给 `src/report/components/site-components/index.tsx` 的 `validateScopeWarningsData` 加判别联合（按 `ScopeWarning.kind` 分支校验必填字段）时，第一版对 `switch (value.kind)` 的 `default` 分支返回了报错（`"kind" must be one of [...]`）。跑 `site-components.test.tsx` 立刻炸了两个既有测试：`组排序:...未知 kind 单独成组、message 原样、按 integrity 归位` 与 `下一步随行:...`。两个测试都显式构造了 `{ kind: "future-kind", message: "..." } as unknown as ScopeWarning`，断言 `ScopeWarnings` 组件把它单独成组、`message` 原样渲染、按 integrity 归位——这是渲染层对**未来版本产出的新 kind**的既有前向兼容契约，不是需要拒绝的畸形数据。

## 根因

`docs/feature/results/library.md`「警告 kind 全集」只登记了 4 个 kind（`partial-coverage` / `stale-snapshot` / `unfinished-snapshot` / `unreadable-snapshot`，另有不透出到组件数据的 `missing-startedAt`），但登记表本身不隐含「未登记的 kind 就是错误数据」——`ScopeWarnings` 组件的分组渲染逻辑对未识别 kind 有专门的 fallback 路径（这也是这类判别联合字段在协议层的常见设计：旧渲染器碰到新版本产出的新 kind 时优雅降级而不是崩溃）。收紧 validator 时把"登记表是全集"和"登记表是白名单"搞混了——全集是"当前已知的分支各自的必填字段"，不是"运行时只允许这些值"。

## 修法

`scopeWarningProblem` 的判别 `switch` 只在**匹配到已登记 kind** 时校验该分支的专属字段；`default` 分支不报错，只要求整个联合体共用的最小形状（`kind: string` + `message: string`，这两个字段是 fallback 渲染路径实际读取的）。已改在 `src/report/components/site-components/index.tsx`（commit 见本次 Grid/Stat 实现的同批改动）。对应测试:`src/report/components/site-components/validate.test.ts` 里的「未登记的 kind 只要有 kind/message 就放行」与「未登记的 kind 缺 message 仍报错」两条。

## 适用场景

给任何判别联合类型（`kind` / `type` / `outcome` 等标签字段）写或深化 `validate*Data` 时，先查该字段消费方（渲染组件、grouping/select 逻辑）有没有对"未识别标签值"的显式 fallback 分支——有的话,结构校验的 `default` 分支要跟着放行，只兜共用的最小形状,不能比渲染逻辑更严。反例判断法:改完 validator 先跑该组件族的**既有**测试套件(不是只加新测试),被自己的校验炸掉的旧测试往往就是在验证这类故意的宽松路径。本仓库里 `AttemptConversationReply`(`src/report/components/attempt-detail/index.tsx` 的 `conversationReplyProblem`)同样是判别联合但**没有**已知的 fallback 契约,所以那边 `default` 分支正确地报错——两者要对照消费方代码/测试逐个判断,不能套同一个模板。

## 第二个坑(同一批改动,反方向):深化 validator 炸出的既有测试不总是 validator 错

深化 `AttemptTimelineData.trace`(`TraceSpan[]`)的校验、要求每个 span 有 `traceId`/`spanId`/`startMs`/`endMs` 后,`src/view/view-report.test.ts` 与 `src/view/site-parity.test.ts` 各炸了一个测试,报错都是 `"trace[0].traceId" must be a string`。这次原因不是 validator 太严——两处 fixture 都写的是 `trace: [{ name: "turn", kind: "turn" }] as never`,用 `as never` 强行绕过 TypeScript 塞进一个从来不满足 `TraceSpan` 真实形状的假数据;旧 validator 从没检查过 `trace` 内部字段,这个类型漏洞才一直没被抓到。这次的修法是补全 fixture 成真正合规的 `TraceSpan` 字面量(`{ traceId, spanId, name, kind, startMs, endMs }`),顺手删掉两处 `as never`——不是放宽 validator。

**两个坑合起来的判断法**:深化 validator 炸了既有测试时,先看被拒绝的字段在类型定义里是不是真的必填、且消费方代码有没有为"缺这个字段"设计过 fallback 路径——有 fallback(如上面的 ScopeWarning kind)说 validator 太严,改 validator;没有 fallback 且字段在类型里明明是必填的(如这里的 TraceSpan 字段),往往是 fixture 借 `as never`/`as unknown as X` 一类类型断言偷懒塞了假数据,该改的是 fixture 不是 validator。看到测试代码里的 `as never`/`as unknown as <公开类型>` 就是可疑信号,值得回查它是不是在给一个从未真正满足过的形状打掩护。
