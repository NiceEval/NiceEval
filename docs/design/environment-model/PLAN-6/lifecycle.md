# PLAN-6 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## Owner

| Owner | 起点输入 | 启动后的职责 |
|---|---|---|
| EvalDef | 可选 profile 或 folder-local source;可由 adapter 派生 | 当前题目的 setup、test 与 verifier |
| SandboxSpec | Provider、默认 case、`environments` 与 materializers | 随 Experiment 变化的 sandbox setup |
| Agent | 无 | Agent CLI 与 runtime setup |
| Sandbox 实例 | SandboxSpec 选定的起点 | build/start、ready、能力、证据、finalizer 与 stop |

EvalDef 不返回 Provider-native case。
SandboxSpec setup 也不是第二份起点。

## 选择运行起点

```text
Eval 有 Environment profile/source
  -> environments[profile] 命中:启动表项
  -> 否则 source 有 materializer:物化并启动 source
  -> 否则:该 Eval 计划期 skipped

Eval 没有 Environment
  -> 启动 SandboxSpec 默认 case
  -> 没有默认值:启动 Provider 中性 case
```

setup 内容不改变这条顺序。
需要预制组合时,完整实现仍写进 `environments[profile]`。

## Fresh Attempt

```text
发现或由 adapter 派生 EvalDef
  -> SandboxSpec 解析一个 Sandbox Case
  -> build/locate 并创建完整 case
  -> 等待全部服务与资源 ready
  -> 按声明顺序执行 SandboxSpec setup
  -> 建立 workspace baseline(变更分类账的锚点 commit)
  -> 执行 EvalDef setup
  -> AgentProvisioner / Agent setup
  -> 独立 Experiment state load
  -> Agent turn
  -> materialize hidden verifier 并评分
  -> cleanup hidden verifier
  -> Agent teardown
  -> 独立 Experiment state save
  -> EvalDef teardown
  -> SandboxSpec teardown
  -> Sandbox Case finalizer 与 stop
```

可验证 setup 函数在自己的 setup 节点内部执行 check/install/recheck。
失败时 Attempt 在 Agent turn 前 `errored`,并保留所在 owner 的 phase。

Terminal-Bench 的 mempal 安装发生在 Compose ready 后、workspace baseline 前。
MemoryBench 的仓库 checkout 与依赖安装发生在 baseline 后、Agent setup 前。

「baseline 之后却不进 agent diff」不靠这条顺序保证,靠变更分类账的**归因标签**:baseline 只是对照点 commit,归因由 commit 落在哪一类决定,不由它相对对照点的位置决定。首次 `t.send()` 进入前,workdir 里 EvalDef setup(checkout、依赖安装)与 SandboxSpec setup 落下的全部改动记成一笔 **eval 归因**;send 返回后才记 **agent 归因**;`t.sandbox.diff` 只折叠 agent 归因的那些提交区间。所以 checkout 无论排在对照点前后,都不会漏进 agent 的账。

三类 commit 时点与排除清单的完整契约单源在 [Sandbox · 变更归因](../../../feature/sandbox/architecture.md#变更归因send-区间与分类账),本 Lifecycle 不复述,只声明 setup 层各自归哪一类。

## Fresh 与 Reuse

| 生命周期节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Environment 起点选择与 BuildKey 构建 | 每 Eval 规划,Run 级协调 | 相同 |
| Case create/ready 与 SandboxSpec setup | 每 Attempt 一次 | 每复用周期一次 |
| workspace baseline/reset | 每 Attempt 建立 | 首条建立,后续 reset |
| EvalDef setup | 每 Attempt一次 | reset 后每 Attempt 重新执行 |
| Agent setup | 每 Attempt 一次 | 每 Attempt 一次 |
| state load/save | 按独立 Feature 每 Attempt | 按独立 Feature 每复用周期 |
| teardown、finalizer 与 stop | 每 Attempt 一次 | 每复用周期一次 |

SandboxSpec setup 在一个复用周期内只运行一次。
跨 Attempt 会变化的条件禁止放在这里;它们属于 EvalDef setup、Agent setup 或独立 state lifecycle。
三个 owner 都放不下的每 Attempt 检查需求,由 SandboxSpec setup lifecycle 的独立扩展承接,不恢复通用 Requirement 图。

## Cases

| Case | 起点 | 准备路径 |
|---|---|---|
| C1 题目自带 Environment 较重 | adapter 或 EvalDef 提供 source | Experiment sandbox setup 后接 Eval、Agent setup |
| C2 实验自带 Environment 较重 | SandboxSpec 默认 case | Experiment setup,再跑 Eval、Agent setup |
| C3 双方 Environment 都较重 | Eval source 的 materialized case | Experiment setup 把共享工具装进主 Sandbox |
| C4 多个实验条件 | 起点不变 | SandboxSpec setup 链按显式顺序执行 |
| C5 预装稳定条件 | 默认 case、source 或 profile 映射 | setup 函数 check 命中时跳过 install |
| C6 外部状态 | Environment 起点按 C1-C5 选择 | Agent 就位后按 state Feature load/save |
| C7 活 Sandbox 状态 | 每复用周期一个 case | setup 生命周期按复用周期/Attempt owner 分开 |
| C8 Experiment 起点 | Eval 无 source,使用默认 template | EvalDef setup 在其上安装题目依赖 |
| C9 预制组合 | `environments[profile]` 的完整 case | setup 函数仍检查实际状态 |
| C10 混合批次 | 有 source 走映射/materializer,无 source 走默认 case | 各层 setup 规则不变 |
