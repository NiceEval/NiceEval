# changedOnlyWithin 在后续 orStop 之前被提前求值为 unavailable

`t.sandbox.changedOnlyWithin()` 在它之后还有任何 `.orStop()` 检查时，结果是 `unavailable`（`source-unavailable`），即使 Attempt 的 File Changes 完整可用。

## 现象

下游 NiceEval-Eval 的 `harness/tool-guard` 在 `t.send()` 之后先登记 `t.sandbox.changedOnlyWithin(["evals", "README.md"])`，
随后有 `await t.check(...).orStop()`。真实运行 `@1ZSNARJ625TEZ`：

- `niceeval show @1ZSNARJ625TEZ --diff`：`State complete`，两条变化都在 `evals/` 下；
- `niceeval show @1ZSNARJ625TEZ --assertions`：该条目 `[UNAVAILABLE]`，`Reason source-unavailable`，criterion `sandbox-change-scope/v1`。

同一 Eval 写法下的 `changedPaths()` 不受影响。

## 依据

`docs/feature/sandbox/library/asserting-results.md`：`changedOnlyWithin` 的归因、`diff.ignore` 与 unavailable 规则和 `changedPaths` 相同；
post-run handle 不能作为 stop barrier，Runner 在作者 settle 后才冻结 workspace diff。

## 根因线索

`packages/niceeval/src/assertions/runtime.ts` 的 `settleThrough` 用 `criterion.kind !== "sandbox-result"` 跳过 post-run 条目；
`sandbox-change-scope` 是独立 kind，没有被跳过，于是在 diff 冻结前被提前求值。

## 复现

在 `e2e/eval/evals/change-scope.eval.ts` 的三条 Sandbox 断言之后加一条 `await t.check(...).orStop()`，运行 change-scope 的 E2E。
