# 准入健康（Admission health）—— Lifecycle

## Owner

| Owner | 义务 | 不得越界 |
|---|---|---|
| producer 作者 | 声明健康 definition 与安全的输入 | 不写 Attempt、Assertion 或 Verdict |
| Runner | 每 slot 调度、deadline、隔离与 Run receipt | 不猜测健康值或重试 |
| Agent owner | 在健康通过后运行 `agent.setup` | 不跳过 admission phase |
| Evaluation producer | seal Run-owned receipt 与 Attempt 事实 | 不把健康失败改成评分结果 |

## Fresh slot 时序

```text
reuse planning
  -> fresh slot 取得调度名额
  -> Provider / Sandbox 准备与 agent.ensure
  -> admission-health 健康探测
  -> healthy
       -> mint Attempt
       -> agent.setup
       -> Eval test、Assertion、Verdict
  -> unhealthy / exception / timeout
       -> Run receipt
       -> release 已取得资源
       -> 不建立 Attempt
```

健康探测必须在该 slot 的 `agent.setup` 前完成。它可使用已经按正常顺序取得的 Sandbox 或 Agent ensure
前提，但不能借此提前调用 Agent runtime。

## 次数与收尾

| 动作 | 每 fresh slot | 每 occurrence | 备注 |
|---|---:|---:|---|
| 健康探测 | 一次 | 不限 | 不缓存、不重试 |
| occurrence isolation | 零或一次 | 至多一次 | 首个终止性健康失败触发 |
| Attempt mint | 健康通过时一次 | 不限 | 失败探测为零 |
| `agent.setup` | 健康通过时一次 | 不限 | 绝不在健康探测前 |

不健康、异常或超时后，Runner 仍按已取得资源的 owner 顺序执行 lifecycle 收尾与 Provider finalizer。
收尾失败写入所属 diagnostic，不能倒推建立 Attempt，也不能把 admission receipt 改写成 `healthy`。

## 生产验收

生产入口验收至少运行一条真实 producer：健康时形成 Attempt，不健康时只形成 Run receipt，超时时隔离同一
occurrence 的等待 slot，并确认 `--dry` 没有任何外部调用。CLI 的 human、JSON 与 E2E 都读取同一份生命周期
事实。
