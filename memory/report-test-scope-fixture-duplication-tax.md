---
format: concord.document/v1
id: report-test-scope-fixture-duplication-tax
title: report 测试家族复制 Scope fixture,把一次 makeScope 签名变更放大成四处机械跟改
createdAt: 2026-07-23T16:46:08+08:00
createdAtSource:
  kind: first-recorded
  path: memory/report-test-scope-fixture-duplication-tax.md
  commit: 2c473122456b4472c361ddfa2890918c3c88f1b1
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
    statement: "- 已修 [report-test-scope-fixture-duplication-tax](report-test-scope-fixture-duplication-tax.md) — report 四个测试文件各复制一份 `scopeOf`/`resultsOf`,makeScope 两天两次改签名每次连改四处;修为收敛进 `src/report/components/scope.harness.ts`(`*.harness.ts` 不进 vitest 收集与 dist/report)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# report 测试家族复制 Scope fixture,把一次 makeScope 签名变更放大成四处机械跟改

- **现象**:按 `docs/engineering/testing/churn.md` 的两天窗口(2026-07-21 ~ 07-23)跑跟改率,`compute.test.ts`(7/10)、`attempt-components.test.tsx`(6/7)等 report 测试稳居头部。排查发现其中一部分跟改零断言价值:`scopeOf`/`resultsOf`(包装 `makeScope` + 拼 `Results` stub)在 compute / site-components / dual-render / attempt-components 四个文件里各有一份逐字节相同或近似的副本,`makeScope` 两天内两次改签名(加 `coverage` 参数、`Scope.attempts` 物化加 `attempts` 参数),每次都要在四个文件做同样的机械修改。
- **根因**:同 Feature 的机械构造器被复制而非共享。`docs/engineering/testing/unit/harness.md` 本就允许(且要求)同 Feature 共享 harness——「每个 harness 归属一个 Feature,与使用它的测试同住」;禁止共享的只是**跨 Feature 的场景语义**。这四份副本全在 reports 家族之内,复制没有换来任何隔离收益,只把一次契约变更的税放大成 N 份。
- **修法**(2026-07-23):收敛为 `src/report/components/scope.harness.ts`,导出 `scopeOf` / `resultsOf` / `emptyScopeAndResults`;场景 fixture(各文件的 `snap()`/`res()`)按 harness.md 规则留在原文件。命名用 `*.harness.ts`:vitest 默认 include 只收 `*.test.*` 不会误收,`tsconfig.report-build.json` 的 exclude 增加 `src/report/**/*.harness.ts` 使其不进 `dist/report` 产物。此后 `makeScope`/Scope 形状再变,跟改从 4 处收敛到 1 处。
- **适用场景**:新写测试想复制隔壁文件的构造 helper 时,先判断它是机械构造还是场景语义——机械构造进(或复用)该 Feature 的 `*.harness.ts`,场景语义才留在文件内。
