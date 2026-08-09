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
| [`#eval-assertion-contract`](#eval-assertion-contract) | 公开 Assertion、句柄与计分 API 在真实 evidence 上产生正确 assertion 与 verdict | 单边界 E2E | `e2e/eval/test/assertions.test.ts` | PR |

## eval-context

Repo 内的 Eval 使用主 session、`newSession()` 与多轮 `send()` 产生可区分 marker。测试分别证明 turn、session 与 `t` scope 的消息、
工具、usage 和输出边界，以及新旧 session 的隔离。Direct Agent 足以产生的 case 不为“更真实”接外部模型；HITL、文件或 shell
确实是契约输入时，增加对应的确定性 Agent / Sandbox Eval。

这组测试以 [Context](../../../feature/eval/library/context.md) 的公开行为为 expected，不根据 `src/` 类型或内部事件 reducer 生成答案。

## eval-assertion-contract

公开 Assertion 契约只在本 Repo 完整展开一次，包括值 matcher、turn / session / `t` scope、Sandbox assertion、Judge 的可用与
unavailable 分支、`check` / `require`、句柄修饰以及计分制。不同 evidence 类型可以拆成多条 Eval；“一个 Experiment 跑完”不要求
“一个 Eval 写完全部契约”，也不要求每个 Adapter 重跑同一套方法清单。

Eval 内的断言负责判分；原生测试负责核对 discovery 没漏、预期 Eval 实际运行、进程退出与公开读回中的 assertion / verdict。
正向证据必须来自真实 Direct Agent 或 Sandbox 行为，不能在测试侧手写标准事件来让 matcher 自证。

## 边界

- Adapter Repo 只断言协议转换所需的工具名、入参、session、usage、HITL 等事实；调用某个 Assertion 方法不等于拥有完整契约。
- Report Repo 可以用自己的 Eval 制造 passed / failed / errored、source、conversation 与 timing evidence，但只拥有读取和呈现结果。
- `--dry`、carry 与 `accept` 的跨运行状态变化归 Runner Repo；本域不复制它们。
- 只有真实 Eval 无法稳定制造或区分的纯算法等价类，才按 Unit 例外登记最小矩阵。
