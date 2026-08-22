# 功能域 · Eval、Context 与 Assertions

本域回答一个问题：**用户在真实 NiceEval 项目中编写并运行 Eval 时，Context、公开 Assertion 与 verdict 是否符合契约。**
它由 `e2e/eval/` 功能 Repo 承担，使用安装后的 candidate、签入的 Eval / Experiment 和确定性 Direct Agent；只有文件、diff、shell
或其它 Sandbox evidence 必需时才为对应 case 声明 Sandbox。

每次 Repo invocation 都通过 `niceeval exp --rerun all` 完整生成自己的 `.niceeval`，再从退出码和
`show` 的公开 Report 输出观察结果。
不签入预生成结果，不从 Adapter Repo 注入 Eval，也不伪造 `Turn.events`、session 或 Sandbox ledger。某个契约分支需要不同 evidence
时，直接增加一条目的明确的 Eval。

## Owner 表

| Owner ID | 用户结果 | 形态 | 目标文件 | Lane |
| --- | --- | --- | --- | --- |
| [`#eval-context`](#eval-context) | 多轮、session 与作用域 Context 只看到各自应有的真实事件和 usage | 单边界 E2E | `e2e/eval/test/context.test.ts` | PR |
| [`#eval-assertion-values`](#eval-assertion-values) | 值 Match 登记 Assertion，并在真实 evidence 上给出 passed Verdict | 单边界 E2E | `e2e/eval/test/assertion-values.test.ts` | PR |
| [`#eval-assertion-scopes`](#eval-assertion-scopes) | turn、session 与 attempt scope 在大量真实工具事件上完成断言并发布有界诊断 | 单边界 E2E | `e2e/eval/test/assertion-scopes.test.ts` | PR |
| [`#eval-assertion-score`](#eval-assertion-score) | 计分制正常返回自动封口，Assertion 分值贡献、直接给分与空计分写入公开 Record | 单边界 E2E | `e2e/eval/test/assertion-score.test.ts` | PR |
| [`#eval-assertion-sandbox`](#eval-assertion-sandbox) | Sandbox agent-attributed endpoint diff 与 shell evidence 由公开 Assertion、Report DomainView 和闭合读回观察 | 单边界 E2E | `e2e/eval/test/assertion-sandbox.test.ts` | PR |
| [`#eval-assertion-judge-unavailable`](#eval-assertion-judge-unavailable) | 未配置 Judge 时 required Judge Assertion 以 unavailable 使 Attempt errored，且不进入网络路径 | 单边界 E2E | `e2e/eval/test/assertion-judge-unavailable.test.ts` | PR |

## eval-context

Repo 内的 Eval 使用主 session、`newSession()` 与多轮 `send()` 产生可区分 marker。测试分别证明 turn、session 与 `t` scope 的消息、
工具、usage 和输出边界，以及新旧 session 的隔离。Direct Agent 足以产生的 case 不为“更真实”接外部模型；HITL、文件或 shell
确实是契约输入时，增加对应的确定性 Agent / Sandbox Eval。

这组测试以 [Context](../../../feature/eval/library/context.md) 的公开行为为 expected，不根据 `src/` 类型或内部事件 reducer 生成答案。

## eval-assertion-values

值 Match 在本轮确定性回复上登记并封口为 Assertion，随后折叠为 `passed` Verdict。
这个 owner 明确接管 `niceeval/expect` 的全部 factory。
每个 value、score、tool、command 与 event matcher 都以 matched 和 mismatched 两种结果运行，并从公开 Attempt readback 逐项核对结果。
`calledTool` 还分别验证 name、input、output、status、exact count 与 at-least count；`notCalledTool` 与 `eventOrder` 也各自验证正反结果。
公开 `show --json` 必须读到这些 Assertion 与 Verdict。

## eval-assertion-scopes

turn、session 与 attempt scope 必须以同一批真实工具事件完成断言。
这个 owner 明确接管 tool、command 与 event matcher，以及 present、absent、count、order、scope status 与 failed-action 等 scope assertion。

候选很多时 matcher diagnostic 只保留有界解释材料，
不能让已经完成的 Attempt 因 Assertions document 膨胀而无法发布。owner 至少产生 10,001 个真实 normalized
tool occurrences，涉及末尾 decisive witness、absence/exact/at-least 与 partial source unavailable。

公开
`exp → show --json` 核对 O(1) receipt、typed 五段投影和有界 explanation，不读取私有 Record。

## eval-assertion-score

计分制正常返回由 Runner 自动封口。匹配与不匹配的 points Assertion、直接给分都可由公开 Report
读回；不匹配只贡献零分且 Verdict 仍为 passed。没有分值贡献时 Score 仍是完整的零分 outcome，
由 Assertions 与 Attempt outcome 解释，不另设 durable family。即使 Experiment 开启 earlyExit，
每个 Score Attempt 仍完整运行。

## eval-assertion-sandbox

Sandbox Eval 在真实 send window 中产生 modified、added 和 deleted endpoint delta；Eval 用
`changedPaths`、`fileChanged`、`fileDeleted` 与 `notInDiff` 直接登记 post-run Assertion。测试经
`show` 或 Report 的已发布 DomainView 读取闭合 diff，不读私有落盘、固定 family bytes 或旧的投影声明。

同一 owner 还让第二个 send 区间超过路径保留上限，证明 collector 发布带 `collection-cap-reached`
的确定性 partial File Changes，而不是把证据降格成 `workspace-diff-unavailable`。确定性 Agent 用 POSIX shell
只制造 30,001 个空文件变化，不调用模型或网络。公开 File Changes 必须只保留 1,000 条 structural changes，并登记
`omittedAtLeast: 29,001`。

这个 Experiment 使用仅测试的 read-limited custom Sandbox provider；其子进程变量集合把 `HOME`、`CODEX_HOME` 与
`TMPDIR` 固定在该 case 的隔离项目副本内，且 `readBytes()` 对超过 4,000,000 bytes 的单次读取报错。
旧版 5,430,371-byte 整包导出因此红灯，候选必须靠自动分段通过。

公开 Timing Page 中的 `workspace.diff` 阶段必须在 9 秒内完成。Repo 的 2 分钟预算包含整条
`exp`、安装、两次 `show`、发布和资源回收；该生命周期预算负责发现卡死，不把共享 runner 的调度与进程回收时间
误当成 Experiment 或 `workspace.diff` 的性能。

## eval-assertion-judge-unavailable

未配置 Judge 时，声明 capability 后 required Judge Assertion 保留 `unavailable` 并报告 model unresolved。
Attempt 为 `errored`，CLI 退出码为 1。该场景以公开 Record 的精确原因证明未进入预检或 evaluator 网络路径，
并核对 settlement 没有丢掉有界 failure detail。Judge 未实际返回的 rationale/evidence/detail/citations 必须分别为
unavailable/not-recorded；输入 material 不得冒充 returned evidence，Agent-as-Judge trace 不在本 owner 范围。

每条 Eval 内的 assertion 负责判分；对应原生测试只核对 discovery 没漏、预期 Eval 实际运行、进程退出与公开读回中的 assertion /
verdict。正向证据来自真实 Direct Agent 或 Sandbox 行为，测试不手写标准事件来让 matcher 自证。

## 边界

- Adapter Repo 只断言协议转换所需的工具名、入参、session、usage、HITL 等事实；调用某个 Assertion 方法不等于拥有完整契约。
- Report Repo 可以用自己的 Eval 制造 passed / failed / errored、source、conversation 与 timing evidence，但只拥有读取和呈现结果。
- `--dry`、carry 与 `accept` 的跨运行状态变化归 Runner Repo；本域不复制它们。
- 只有真实 Eval 无法稳定制造或区分的纯算法等价类，才按 Unit 例外登记最小矩阵。
