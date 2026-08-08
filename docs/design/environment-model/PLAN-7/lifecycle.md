# PLAN-7 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md)

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| EvalDef | Environment、setup、test、teardown | 题目准备、Agent 交互、文件传输与判分 |
| SandboxSpec | Provider、默认 case、`environments` 映射表、materializer、setup | 选定一个 case 并准备 Experiment 条件 |
| Agent | Agent setup | 安装 CLI、配置 runtime、执行 turn |
| Sandbox 实例 | build/start/ready/finalizer | 创建并销毁完整的隔离 Sandbox |

文件传输是 Eval 普通代码，不新增 owner。

## Fresh Attempt

```text
发现 EvalDef 与源码闭包
  -> SandboxSpec 解析唯一 Sandbox Case
  -> build/start/ready，并记录 Agent 可见 closure
  -> SandboxSpec setup
  -> workspace baseline
  -> EvalDef setup
  -> Agent setup
  -> test(t) 按源码顺序执行普通上传、send、命令与断言
  -> 每次本地上传写入 transfer manifest
  -> 折叠 send-window agent diff
  -> 动态 source 与 Agent 可见 closure 比对
  -> scoring finalize
  -> EvalDef / Agent / SandboxSpec teardown
  -> Sandbox Case finalizer and stop
```

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Case create/ready 与 SandboxSpec setup | 每 Attempt | 每复用周期 |
| workspace baseline/reset | 每 Attempt 建立 | 首条建立，后续 reset |
| EvalDef setup、Agent setup 与 test | 每 Attempt | reset 后每 Attempt |
| transfer manifest 与泄漏比对 | 每 Attempt | 每 Attempt |
| Case finalizer/stop | 每 Attempt | 每复用周期 |

下一条 Attempt 必须等待 reset 完成。
普通上传、测试临时文件或 Agent 修改只要无法恢复到已知状态，就终止该复用周期。

## 错误与收尾

| 失败位置 | phase | 后续动作 |
|---|---|---|
| 本地 source 读取或上传 | eval.run | 进入 teardown |
| `t.send()` | eval.run / agent.run | 按 turn failure 契约处理 |
| 跑测命令 | eval.run | 作者可断言非零结果；基础设施异常进入 teardown |
| 动态泄漏比对 | `workspace.diff` 后、`assertions.evaluate` 前 | Attempt errored，不接受 verdict |
| reset | teardown diagnostic | 禁止复用该 Sandbox |

没有 `eval.verify` 或 `eval.afterAgent` phase。
时间树在 `eval.run` 下按真实调用顺序写入普通 upload、command 与 turn activity。

## Cases

| Case | 起点与准备 | 文件行为 |
|---|---|---|
| C1-C5 | 单一起点加三层 setup | Eval 普通代码按顺序传输 |
| C6-C7 | 外部 state 与复用保持独立 | reset 是复用屏障 |
| C8-C10 | 默认 case、预制完整 case 与混合选择不变 | transfer manifest 属于逐 Attempt 证据 |
| C11 | 每题自包含定义 | 无顶层登记、无文件字段、无共享 Eval 工厂 |
