# PLAN-7 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| EvalDef | Environment、Fixture、test、verifier、private files | 题目准备、Agent 交互与判分 |
| SandboxSpec | Provider、默认 case、覆盖表、materializer、setup | 解析一个 case 并准备 Experiment 条件 |
| Agent | Agent setup | 安装 CLI、配置 runtime、执行 turn |
| Sandbox Case | build/start/ready/finalizer | 创建并清理完整隔离环境 |

Fixture 与 verifier 都由 EvalDef 拥有，但可见时机不同。
两者不成为 Environment contribution。

## Fresh Attempt

```text
发现 EvalDef 并解析 fixture/verifier/private 文件
  -> 计算逐 Eval 身份并执行泄题门
  -> SandboxSpec 解析唯一 Sandbox Case
  -> build/start/ready
  -> SandboxSpec setup
  -> workspace baseline
  -> EvalDef setup
  -> 上传 fixture.files
  -> Agent setup
  -> Agent turn(s) from test(t)
  -> 封闭 Agent 驱动面并冻结 agent diff
  -> 上传 verifier.files
  -> verifier.verify(v)
  -> 删除 verifier.files
  -> EvalDef teardown
  -> Agent/SandboxSpec teardown
  -> Sandbox Case finalizer and stop
```

任一 verifier file 上传失败都属于 `eval.verify`，不会执行 `verify(v)`。
已经上传一部分时仍进入清理链。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Case create/ready 与 SandboxSpec setup | 每 Attempt | 每复用窗口 |
| workspace baseline/reset | 每 Attempt 建立 | 首条建立，后续 reset |
| EvalDef setup 与 fixture upload | 每 Attempt | reset 后每 Attempt |
| Agent setup 与 turn | 每 Attempt | 每 Attempt |
| verifier upload/verify/cleanup | 每 Attempt | 每 Attempt，cleanup 后才允许下一条 |
| Case finalizer/stop | 每 Attempt | 每复用窗口 |

复用窗口的下一条 Attempt 必须从 verifier cleanup 完成后的已知状态开始。
cleanup 失败时窗口停止复用；Runner 不把可能残留隐藏判据的 Sandbox 交给下一条 Agent。

## 错误与收尾

| 失败位置 | phase | 是否进入 Agent turn | 后续动作 |
|---|---|---|---|
| file source 解析或泄题门 | planning | 否 | 不创建 Sandbox |
| fixture upload | eval.setup | 否 | 进入已走到 owner 的 teardown |
| `test(t)` | eval.run | 可能已进入 | 不运行 verifier，进入 teardown |
| verifier upload 或 `verify(v)` | eval.verify | Agent 已结束 | 清理 verifier，再进入 teardown |
| verifier cleanup | teardown diagnostic | Agent 已结束 | 禁止复用该 Sandbox |

`verify(v)` 的断言失败产生正常 verdict，不等于 lifecycle error。
只有上传、执行基础设施或 callback 抛错进入 `eval.verify` error。

## Cases

| Case | 起点与准备 | 文件生命周期 |
|---|---|---|
| C1-C5 | 单一起点加三层 setup | 按 Eval 是否声明文件执行 |
| C6-C7 | 外部 state 与复用保持独立 | verifier cleanup 是复用屏障 |
| C8-C10 | 默认 case、预制覆盖与混合解析不变 | 文件仍属于逐 Eval 身份 |
| C11 | 每题自包含定义 | 无模块顶层登记；Runner 受管上传与清理 |
