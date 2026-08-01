# PLAN-7 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| EvalDef | Environment、Fixture、criteria、test、private files | 题目准备、Agent 交互与 turn 后操作 |
| SandboxSpec | Provider、默认 case、覆盖表、materializer、setup | 解析一个 case 并准备 Experiment 条件 |
| Agent | Agent setup | 安装 CLI、配置 runtime、执行 turn |
| Sandbox Case | build/start/ready/finalizer | 创建并清理完整隔离环境 |

Fixture 与 criteria 都由 EvalDef 拥有，但语义不同。
Fixture 是固定的 Agent 前 mount；criteria 是发现期身份，只有 `afterAgent` callback 能决定是否、怎样上传。

## Fresh Attempt

```text
发现 EvalDef 并解析 fixture/criteria/private 文件
  -> 计算逐 Eval 身份并执行泄题门
  -> SandboxSpec 解析唯一 Sandbox Case
  -> build/start/ready
  -> SandboxSpec setup
  -> workspace baseline
  -> EvalDef setup
  -> 上传 fixture.files
  -> Agent setup
  -> test(t) 驱动 Agent turn(s)
  -> t.afterAgent(...) 不可逆关闭 Agent 驱动面
  -> 冻结 agent diff
  -> callback 通过普通 API 上传 criteria、运行命令与断言
  -> 清理受管 criteria 上传
  -> scoring finalize
  -> EvalDef teardown
  -> Agent/SandboxSpec teardown
  -> Sandbox Case finalizer and stop
```

Eval 不调用 `afterAgent` 时没有该 phase。
`test(t)` 在边界前抛错时不进入 callback；callback 开始后无论上传、命令或断言基础设施是否失败，都进入受管清理链。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Case create/ready 与 SandboxSpec setup | 每 Attempt | 每复用窗口 |
| workspace baseline/reset | 每 Attempt 建立 | 首条建立，后续 reset |
| EvalDef setup 与 fixture upload | 每 Attempt | reset 后每 Attempt |
| Agent setup 与 turn | 每 Attempt | 每 Attempt |
| afterAgent callback 与受管清理 | 声明时每 Attempt | 声明时每 Attempt，清理/reset 后才允许下一条 |
| Case finalizer/stop | 每 Attempt | 每复用窗口 |

复用窗口的下一条 Attempt 必须从 after-Agent cleanup 与 reset 完成后的已知状态开始。
cleanup 或 reset 失败时窗口停止复用；Runner 不把可能残留隐藏判据的 Sandbox 交给下一条 Agent。

## 错误与收尾

| 失败位置 | phase | 是否进入 Agent turn | 后续动作 |
|---|---|---|---|
| file source 解析或泄题门 | planning | 否 | 不创建 Sandbox |
| fixture upload | eval.setup | 否 | 进入已走到 owner 的 teardown |
| `test(t)` 在边界前失败 | eval.run | 可能已进入 | 不运行 callback，进入 teardown |
| `afterAgent` callback 的上传、命令或基础设施失败 | eval.afterAgent | Agent 已结束 | 清理受管上传，再进入 teardown |
| criteria cleanup / reset | teardown diagnostic | Agent 已结束 | 禁止复用该 Sandbox |

callback 内的断言失败产生正常 verdict，不等于 lifecycle error。
重复调用 `afterAgent`，或跨过边界后再次调用 Agent 能力，属于 `eval.afterAgent` error。

## Cases

| Case | 起点与准备 | 文件生命周期 |
|---|---|---|
| C1-C5 | 单一起点加三层 setup | 按 Eval 是否声明文件执行 |
| C6-C7 | 外部 state 与复用保持独立 | after-Agent cleanup/reset 是复用屏障 |
| C8-C10 | 默认 case、预制覆盖与混合解析不变 | 文件仍属于逐 Eval 身份 |
| C11 | 每题自包含定义 | 无模块顶层登记；criteria 与边界正交，callback 用普通 API |
