# 结果携带与 Sandbox 复用反馈

结果携带与 Sandbox 复用是两套正交机制。
[缓存与携带](../../feature/experiments/cache.md)复用历史 Attempt 的判定与证据；[Sandbox 复用](../../feature/sandbox/reuse.md)让本次 Invocation 的多条 Attempt 共用运行环境，但每条 Attempt 仍真实执行。

Feature 已定稿两套机制的行为边界。
本主题只保留两项尚未定稿的反馈问题：结果携带仍在部分表面叫 `reused`，Sandbox 复用缺少运行级汇总。

## 结果携带统一叫 `carried`

记录读取面已经使用 `attempt.carried`，`PLAN` 也显示 `carried in from cache`。
live 面板、结束反馈与机器输出仍使用 `reused`，而 Attempt 记录中的 `sandbox.reused` 表示 Sandbox 复用。
同一个词因此同时表示「没有执行」和「在共用环境里真实执行」。

候选契约把结果携带的公开名字统一为 `carried`：

| 表面 | 候选形状 |
|---|---|
| live 面板与结束反馈 | `6 carried` |
| `niceeval.exp` JSONL | `carried: number` |
| `niceeval.exp-plan` | 顶层 `carried: number`；矩阵行 `carried: boolean` |
| Record 读取 API | 保持 `attempt.carried` |
| Attempt 的 Sandbox 调度事实 | 保持 `sandbox.reused` |

字段改名不保留 `reused` 别名。
待裁决：`niceeval.exp` 与 `niceeval.exp-plan` 是否同时递增 `schemaVersion`，以及第三方 reducer 的迁移错误怎样点名旧字段。

## Sandbox 复用增加运行级汇总

Attempt 已记录 `sandbox.reused`、本次 Run 内的 Sandbox 编号和承接序号，收尾也会诊断后续承接集中失败的污染迹象。
运行中仍看不到一个 Experiment 创建了多少 Sandbox、已经承接多少 Attempt，以及是否因 reset 或寿命不足更换过实例。

候选契约为声明 `sandboxReuse` 的 Experiment 增加四个运行级量：

| 量 | 口径 |
|---|---|
| `active` | 当前可以继续承接 Attempt 的 Sandbox 数 |
| `created` | 本次 Invocation 成功完成 SandboxSpec setup 的 Sandbox 累计数 |
| `assignments` | 已租借 Sandbox 的 Attempt 累计数；租借后的 setup 失败或超时仍计入 |
| `replacements` | ready Sandbox 因 reset、寿命确认或收尾失败退出池后，成功建立替代 Sandbox 的累计数 |

live 面板按 Experiment 显示当前值；结束反馈显示最终累计值。
多个复用 Experiment 不合成一组总数，否则无法判断哪一个 Experiment 在轮换实例。
机器输出使用与人读面同口径的逐 Experiment 数组；逐实例承接明细继续归 `niceeval view` / `show`，不进入运行流。

待裁决：

1. live 面板只显示非零 `replacements`，还是四项恒定显示。
2. 机器输出把汇总附在既有 `progress` / `result` 事件，还是使用独立的 `sandbox_reuse` 事件。
3. `created` 是否需要再拆成成功进入池与 setup 失败两个量；后者已有阶段错误，重复计数可能制造第二套失败口径。

## 不在本主题里的问题

- 生效并发已经由 Experiments CLI 显示全局来源与逐 Experiment 上限，不在这里重复设计。
- 留存实例与孤儿分别由 `sandbox list`、`sandbox list --orphans` 回答；本主题不新增 Provider 配额盘点。
- 不提供 `--reuse-verify`。
  同一 Eval 连跑两次相同不能证明没有残留污染，不同也可能来自 Agent 随机性；需要验证特定残留风险时，由作者写专门 Eval。
- 不改变 Sandbox 复用生命周期、题间 reset、Provider 寿命确认或结果携带的六道门。
