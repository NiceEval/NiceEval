# 功能域 · Eval、Context 与 Assertions

本域回答一个问题：**用户在真实 NiceEval 项目中编写并运行 Eval 时，Context、公开 Assertion 与 verdict 是否符合契约。**
它由 `e2e/eval/` 功能 Repo 承担，使用安装后的 candidate、签入的 Eval / Experiment 和确定性 Direct Agent；只有文件、diff、shell
或其它 Sandbox evidence 必需时才为对应 case 声明 Sandbox。

每次 Repo invocation 都通过 `niceeval exp --rerun all` 完整生成自己的 `.niceeval`，再从退出码、`show` 或公开 Record API 观察结果。
不签入预生成结果，不从 Adapter Repo 注入 Eval，也不伪造 `Turn.events`、session 或 Sandbox ledger。某个契约分支需要不同 evidence
时，直接增加一条目的明确的 Eval。

## Owner 表

| Owner ID | 用户结果 | 形态 | 目标文件 | Lane |
| --- | --- | --- | --- | --- |
| [`#eval-context`](#eval-context) | 多轮、session 与作用域 Context 只看到各自应有的真实事件和 usage | 单边界 E2E | `e2e/eval/test/context.test.ts` | PR |
| [`#eval-assertion-values`](#eval-assertion-values) | 值 matcher 与通过制 handle modifiers 在真实 evidence 上给出 passed verdict | 单边界 E2E | `e2e/eval/test/assertion-values.test.ts` | PR |
| [`#eval-assertion-scopes`](#eval-assertion-scopes) | turn、session 与 attempt scope 在真实工具事件上完成断言 | 单边界 E2E | `e2e/eval/test/assertion-scopes.test.ts` | PR |
| [`#eval-assertion-score`](#eval-assertion-score) | 计分制 handle modifiers 与直接给分写入公开 Record | 单边界 E2E | `e2e/eval/test/assertion-score.test.ts` | PR |
| [`#eval-assertion-sandbox`](#eval-assertion-sandbox) | Sandbox 文件与 shell evidence 由公开 assertion 与 Record 判定 | 单边界 E2E | `e2e/eval/test/assertion-sandbox.test.ts` | PR |
| [`#eval-assertion-judge-unavailable`](#eval-assertion-judge-unavailable) | 未配置 Judge 时 optional assertion 保留 unavailable | 单边界 E2E | `e2e/eval/test/assertion-judge-unavailable.test.ts` | PR |

## eval-context

Repo 内的 Eval 使用主 session、`newSession()` 与多轮 `send()` 产生可区分 marker。测试分别证明 turn、session 与 `t` scope 的消息、
工具、usage 和输出边界，以及新旧 session 的隔离。Direct Agent 足以产生的 case 不为“更真实”接外部模型；HITL、文件或 shell
确实是契约输入时，增加对应的确定性 Agent / Sandbox Eval。

这组测试以 [Context](../../../feature/eval/library/context.md) 的公开行为为 expected，不根据 `src/` 类型或内部事件 reducer 生成答案。

## eval-assertion-values

值 matcher 与通过制 handle modifiers 在本轮确定性回复上折叠为 `passed`。公开 `show --json` 和 Record 都必须读到该结果与
值 assertion 的 marker。

## eval-assertion-scopes

turn、session 与 attempt scope 必须以同一批真实工具事件完成断言；公开 execution readback 同时保留主支工具身份。

## eval-assertion-score

计分制 handle modifiers 与直接给分在公开 Record 中写成 points verdict 和具名 score entry。

## eval-assertion-sandbox

Sandbox 的真实文件与 shell evidence 由公开 assertion 和 Record 判定；readback 包含 agent 写入的 diff marker。

## eval-assertion-judge-unavailable

未配置 Judge 时，optional assertion 保留 `unavailable` 并报告 model unresolved；该场景不发起付费模型调用。

每条 Eval 内的 assertion 负责判分；对应原生测试只核对 discovery 没漏、预期 Eval 实际运行、进程退出与公开读回中的 assertion /
verdict。正向证据来自真实 Direct Agent 或 Sandbox 行为，测试不手写标准事件来让 matcher 自证。

## 边界

- Adapter Repo 只断言协议转换所需的工具名、入参、session、usage、HITL 等事实；调用某个 Assertion 方法不等于拥有完整契约。
- Report Repo 可以用自己的 Eval 制造 passed / failed / errored、source、conversation 与 timing evidence，但只拥有读取和呈现结果。
- `--dry`、carry 与 `accept` 的跨运行状态变化归 Runner Repo；本域不复制它们。
- 只有真实 Eval 无法稳定制造或区分的纯算法等价类，才按 Unit 例外登记最小矩阵。
