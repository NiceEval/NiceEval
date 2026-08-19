# 功能域 · Runner

本域回答一个问题：**确定性 Runner 项目在真实候选包上是否正确计划、携带与去重历史 attempt。**
它由 `e2e/runner/` 功能 Repo 承担；manifest 的 `areas` 包含 `runner`，并进入无密钥 PR lane。

仓库使用签入的确定性 Agent fixture，不依赖真实 provider、网络或凭据。每条会修改 Eval 或结果的 case 都在自己的项目副本中运行；公开观察只通过安装后的 `niceeval exp` 与 `niceeval show` 完成。

## Owner 表

| Owner ID | 用户结果 | 形态 | 文件 | Lane |
| --- | --- | --- | --- | --- |
| [`#runner-carry-partial-reuse`](#runner-carry-partial-reuse) | 改变一个 Eval 只重新派发其 identity，未改变的 Eval 继续携带 | Journey E2E | `e2e/runner/test/carry-partial-reuse.test.ts` | PR |
| [`#runner-history-dedup`](#runner-history-dedup) | 强制重跑或同时运行同一实验时，不重复执行已经完成的题目 | Journey E2E | `e2e/runner/test/history-dedup.test.ts` | PR |
| [`#runner-accept-reanchor`](#runner-accept-reanchor) | 用户审阅变更后 accept 旧结果，新 Run 立即进入 project-current，但不获得未来 carry 许可，并保留审计 provenance | Journey E2E | `e2e/runner/test/accept-reanchor.test.ts` | PR |
| [`#runner-group-or-stop-dispatch`](#runner-group-or-stop-dispatch) | 一个 Eval 的 `.orStop()` 不饿死其它 Eval Group lane | Journey E2E | `e2e/runner/test/group-or-stop-dispatch.test.ts` | PR |
| [`#runner-group-wave-gap-dispatch`](#runner-group-wave-gap-dispatch) | 慢 Group lane 不阻塞已有空闲资源的快 lane 后继 | Journey E2E | `e2e/runner/test/group-wave-gap-dispatch.test.ts` | PR |
| [`#runner-shared-state-lifecycle`](#runner-shared-state-lifecycle) | 相同 `sharedState.key` 的不同 Experiment 不交错外部状态生命周期 | Journey E2E | `e2e/runner/test/shared-state-lifecycle.test.ts` | PR |

## 验收命题

### runner-carry-partial-reuse

在私有项目副本中只改变一个 Eval 源码。选中该 Eval 的 dry plan 必须标为重新派发；执行后，全量 dry plan 与真实 dispatch 必须只携带更新后的该 Eval 和从未变化的另一 Eval。该命题排除“一个改动作废全矩阵”与“改动仍误携带”的两种错误。

### runner-history-dedup

同一 Eval 的两次 `--rerun all` 必须形成两条不同的 origin Attempt identity。之后默认 carry 不能复制新的公开 Attempt locator。不带 locator 或 `--run` 的 `show` 必须列出全部身份仍匹配的 Run，包括两次 origin Run 与 carry Run。

两个终端同时运行同一个实验时，后开始的命令会等前一个命令完成发布。它随后直接使用前一个命令已经完成的题目结果，不会再次调用 agent、sandbox 或 judge 去跑同一题目。

### runner-group-or-stop-dispatch

两个 Group 的首条 Eval 以 `.orStop()` 失败时，后继成员仍须与第三个 Group 的 in-flight 成员并行进入 Agent。该 Journey 守护失败只结束当前 Eval、不同 Group lane 继续派发；排查经过见 [`memory/group-or-stop-dispatch-starvation.md`](../../../../memory/group-or-stop-dispatch-starvation.md)。

### runner-group-wave-gap-dispatch

三个 Group 各自拥有三条串行 Eval。gamma 首槽在 Agent 内等待 alpha 与 beta 的第三槽到达；若调度器要求第二 wave 的所有 lane 都先取得并发位，gamma 第二槽会被自身 predecessor 挡住，alpha 与 beta 第三槽也会被第二轮统一准入挡住。正确实现只对所有 lane 的首槽做一次公平屏障，九条 Eval 全部通过。

### runner-accept-reanchor

在私有项目副本中完整运行初始 Experiment，并从公开执行输出取得 locator。随后修改 Eval 入口或被导入源码模块。

Human `--dry` 对 identity gap 必须关联具名差异原因、旧 Attempt 的 locator / verdict，以及可直接复制的
`niceeval accept @<locator>`。JSON `--dry` 只稳定验收 total / reused、slot state 和 readback locator / verdict；format、version
与私有容器形状不是本 Journey 的契约。

accept 在新 Run 写入 reference Member，locator 仍是同一 source Attempt identity，不生成或改写
Attempt。用户用返回的 Run ID 执行 `show --run`，公开读回保留源 Attempt 的 verdict / evidence；
目标 Member 的 action 说明本次采用，不另建 provenance family。

同一 Journey 随后执行无 `--run` 的 `show --json`。默认 `project-current` 必须选中刚创建的 accepted Run，且分母只包含它的当前 Slot。
这证明 accept 与普通 current planning 使用同一份 link 后 Experiment、physical plan、fingerprint 与 config identity，而不只是证明历史 Run 可被 explicit selector 打开。

`accepted` 只解释该 Run 当时为何采用这个 Attempt，不是未来复用许可。后续 `--dry` 仍按当前 reuse
policy 重新判断；原来的 identity gap 不会因为历史上执行过 accept 而被静默改成 carried。

本 Journey 不签入 `.niceeval`、不手写 manifest，也不从 accept 中段开始。不同资格、差异或错误分支需要独立输入时，可以在
Runner Repo 增加专用 Eval；完整 fingerprint 等价类仍不在 E2E 重复穷举。

### runner-shared-state-lifecycle

两个不同 Experiment 声明相同 `sharedState.key`，并在各自 Experiment hook 中独占同一份外部状态。第一个 Run 从 setup
到 teardown 尚未结束时，第二个 Run 不得进入自己的 setup；前者 teardown 完成后，后者才可取得该状态并完整运行。
该 Journey 经安装后的 `niceeval exp` 证明等待方没有在共享状态区间内运行 Hook 或执行 Eval。

## 边界

指纹输入等价类、携带门的穷举、barrier / fake-clock 并发与资源生命周期是无法由此确定性消费项目稳定穷举的 Unit 例外。它们必须按 [Unit 存在资格](../unit/README.md#存在资格)保留最小矩阵；本域不复制这些内部算法矩阵。
