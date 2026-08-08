# 结果携带与 Sandbox 复用反馈

结果携带与 Sandbox 复用是两套正交机制。
[缓存与携带](../../feature/experiments/cache.md)复用历史 Attempt 的判定与证据；[Sandbox 复用](../../feature/sandbox/reuse.md)让本次 Invocation 的多条 Attempt 共用运行 Sandbox，但每条 Attempt 仍真实执行。

两套机制的行为边界继续由 Feature 契约定义。
本主题统一结果携带的公开名字，并为 Sandbox 复用定义运行级汇总。

## 结果携带统一叫 `carried`

所有公开反馈把结果携带称为 `carried`。
`sandbox.reused` 只表示 Attempt 在共用 Sandbox 中真实执行，两个概念不共享字段名。

| 表面 | 目标形状 |
|---|---|
| live 面板与结束反馈 | `6 carried` |
| `niceeval.exp` JSONL | `carried: number` |
| `niceeval.exp-plan` | 顶层 `carried: number`；矩阵行 `carried: boolean` |
| Record 读取 API | 保持 `attempt.carried` |
| Attempt 的 Sandbox 调度事实 | 保持 `sandbox.reused` |

字段改名不保留 `reused` 别名。
`niceeval.exp` 事件流升为 schemaVersion 2，`niceeval.exp-plan` 升为 schemaVersion 4。
消费方先按版本分流；旧 reducer 收到不支持的版本时报告 `unsupported schemaVersion`，不探测 `reused` 猜版本。

## Sandbox 复用增加运行级汇总

Attempt 持久化 `sandbox.reused`、本次 Run 内的 Sandbox 编号和承接序号。
声明 `sandboxReuse` 的 Experiment 按现有物理复用池提供四个运行级量；Eval Group 则直接以自身作为这组计数的声明源：

| 量 | 口径 |
|---|---|
| `active` | 当前可以继续承接 Attempt 的 Sandbox 数 |
| `created` | 本次 Invocation 完成 Case 就绪并承接首条 Attempt 的 Sandbox 累计数 |
| `assignments` | 已租借 Sandbox 的 Attempt 累计数；租借后的 prepare 失败或超时仍计入 |
| `replacements` | ready Sandbox 因 reset、寿命确认或收尾失败退出池后，成功建立替代 Sandbox 的累计数 |

live 面板按 Experiment 与 Eval Group 恒定显示 `active`、`created` 与 `assignments`，`replacements` 只在非零时显示。
结束反馈显示四项最终值。
多个组不合成一组总数，否则无法判断哪一个组在轮换实例。
机器输出在既有 `progress` 与 `result` 事件上附加逐 Experiment、逐 group 的 `sandboxReuse` 数组，不增加独立事件。
数组每项带 `experimentId`、group 身份与四个量；机器面四项恒定存在。
逐实例承接明细继续归 `niceeval view` / `show`，不进入运行流。

`created` 只计成功进入池并承接首条 Attempt 的实例，不再拆就绪失败计数。
就绪失败沿既有 phase 错误与 diagnostic 反馈，避免汇总复制第二套失败口径。

## 不在本主题里的问题

- 生效并发已经由 Experiments CLI 显示全局出处与逐 Experiment 上限，不在这里重复设计。
- 留存实例与孤儿分别由 `sandbox list`、`sandbox list --orphans` 回答；本主题不新增 Provider 配额盘点。
- 不提供 `--reuse-verify`。
  同一 Eval 连跑两次相同不能证明没有残留污染，不同也可能来自 Agent 随机性；需要验证特定残留风险时，由作者写专门 Eval。
- 不改变 Sandbox 复用生命周期、题间 reset、Provider 寿命确认或结果携带的六道门。
