# report 测试家族复制 Scope fixture,把一次 makeScope 签名变更放大成四处机械跟改

- **现象**:按 `docs/engineering/testing/architecture/churn.md` 的两天窗口(2026-07-21 ~ 07-23)跑跟改率,`compute.test.ts`(7/10)、`attempt-components.test.tsx`(6/7)等 report 测试稳居头部。排查发现其中一部分跟改零断言价值:`scopeOf`/`resultsOf`(包装 `makeScope` + 拼 `Results` stub)在 compute / site-components / dual-render / attempt-components 四个文件里各有一份逐字节相同或近似的副本,`makeScope` 两天内两次改签名(加 `coverage` 参数、`Scope.attempts` 物化加 `attempts` 参数),每次都要在四个文件做同样的机械修改。
- **根因**:同 Feature 的机械构造器被复制而非共享。`docs/engineering/testing/architecture/unit/harness.md` 本就允许(且要求)同 Feature 共享 harness——「每个 harness 归属一个 Feature,与使用它的测试同住」;禁止共享的只是**跨 Feature 的场景语义**。这四份副本全在 reports 家族之内,复制没有换来任何隔离收益,只把一次契约变更的税放大成 N 份。
- **修法**(2026-07-23):收敛为 `src/report/components/scope.harness.ts`,导出 `scopeOf` / `resultsOf` / `emptyScopeAndResults`;场景 fixture(各文件的 `snap()`/`res()`)按 harness.md 规则留在原文件。命名用 `*.harness.ts`:vitest 默认 include 只收 `*.test.*` 不会误收,`tsconfig.report-build.json` 的 exclude 增加 `src/report/**/*.harness.ts` 使其不进 `dist/report` 产物。此后 `makeScope`/Scope 形状再变,跟改从 4 处收敛到 1 处。
- **适用场景**:新写测试想复制隔壁文件的构造 helper 时,先判断它是机械构造还是场景语义——机械构造进(或复用)该 Feature 的 `*.harness.ts`,场景语义才留在文件内。
