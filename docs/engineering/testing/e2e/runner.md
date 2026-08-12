# 功能域 · Runner

本域回答一个问题：**确定性 Runner 项目在真实候选包上是否正确计划、携带与去重历史 attempt。**
它由 `e2e/runner/` 功能 Repo 承担；manifest 的 `areas` 包含 `runner`，并进入无密钥 PR lane。

仓库使用签入的确定性 Agent fixture，不依赖真实 provider、网络或凭据。每条会修改 Eval 或结果的 case 都在自己的项目副本中运行；公开观察只通过安装后的 `niceeval exp` 与 `niceeval show` 完成。

## Owner 表

| Owner ID | 用户结果 | 形态 | 文件 | Lane |
| --- | --- | --- | --- | --- |
| [`#runner-carry-partial-reuse`](#runner-carry-partial-reuse) | 改变一个 Eval 只重新派发其 identity，未改变的 Eval 继续携带 | Journey E2E | `e2e/runner/test/carry-partial-reuse.test.ts` | PR |
| [`#runner-history-dedup`](#runner-history-dedup) | 强制重跑追加历史 identity，carry 不复制已有 attempt | Journey E2E | `e2e/runner/test/history-dedup.test.ts` | PR |
| [`#runner-accept-reanchor`](#runner-accept-reanchor) | 用户审阅变更后 accept 旧结果，新结果重锚并可继续 carry，且保留审计 provenance | Journey E2E | `e2e/runner/test/accept-reanchor.test.ts` | PR |

## 验收命题

### runner-carry-partial-reuse

在私有项目副本中只改变一个 Eval 源码。选中该 Eval 的 dry plan 必须标为重新派发；执行后，全量 dry plan 与真实 dispatch 必须只携带更新后的该 Eval 和从未变化的另一 Eval。该命题排除“一个改动作废全矩阵”与“改动仍误携带”的两种错误。

### runner-history-dedup

同一 Eval 的两次 `--rerun all` 必须形成两条不同的 origin Attempt identity。之后默认 carry 的 latest-only current view 必须仍指向最近一次强制运行的 locator；它不能为 carry 复制新的公开 Attempt locator。

### runner-accept-reanchor

在私有项目副本中完整运行初始 Experiment，并从公开执行输出取得 locator。随后修改 Eval 入口或被导入源码模块。

Human `--dry` 对 identity gap 必须关联具名差异原因、旧 Attempt 的 locator / verdict，以及可直接复制的
`niceeval accept @<locator>`。JSON `--dry` 只稳定验收 total / reused、slot state 和 readback locator / verdict；format、version
与私有容器形状不是本 Journey 的契约。

accept 在新 Run 写入 reference Member，locator 仍是同一 source Attempt identity，不生成或改写 Attempt。latest-only current view
必须指向这个 adoption Run；公开读回保留源 Attempt 的 verdict / evidence，采用原因由 membership provenance 表达。

`accepted` 只解释该 Run 当时为何采用这个 Attempt，不是未来 eligibility grant。后续 `--dry` 仍按当前 eligibility 重新判断；原来的 identity
gap 不会因为历史上执行过 accept 而被静默改成 carried。

本 Journey 不签入 `.niceeval`、不手写 manifest，也不从 accept 中段开始。不同资格、差异或错误分支需要独立输入时，可以在
Runner Repo 增加专用 Eval；完整 fingerprint 等价类仍不在 E2E 重复穷举。

## 边界

指纹输入等价类、携带门的穷举、barrier / fake-clock 并发与资源生命周期是无法由此确定性消费项目稳定穷举的 Unit 例外。它们必须按 [Unit 存在资格](../unit/README.md#存在资格)保留最小矩阵；本域不复制这些内部算法矩阵。
