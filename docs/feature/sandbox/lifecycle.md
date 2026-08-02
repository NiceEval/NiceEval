# Sandbox 三方准备时序

本篇回答四个运行问题:

1. Eval、Experiment 与 Agent 分别贡献什么。
2. 每个配对怎样在创建资源前确定唯一 template。
3. Case 启动后,三层准备按什么顺序执行,失败归到哪里。
4. `sandboxReuse` 打开后,哪些步骤每窗口一次,哪些步骤仍然每 Attempt 执行。

作者声明面见 [Sandbox Layer](layers.md);template 之下的完整运行单位见 [Sandbox Case](case.md)。

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| Eval layer | 可选 template、逐 Attempt 的 SandboxCommand、test | 题目起点、题目准备、Agent 交互与判分 |
| Experiment layer | 可选 template、逐 Attempt 的 SandboxCommand | 实验起点或实验准备 |
| Agent layer | Adapter 的 ensure 声明序列与配对的 Agent 安装层,由 Runner 组装 | CLI identity、probe、payload、平台、安装与复检 |
| Provider Case | template planner、build、start、ready、finalizer | 创建、观测、复用并清理完整资源组 |
| [State](../state/README.md) | load、save、临界区与窗口状态 | 外部或跨 Attempt 实验状态 |

Eval 与 Experiment 的 `sandbox` 字段使用同一个 `SandboxLayer` 类型。
Agent layer 只共享排序位置,ensure 循环的协议不降格成普通命令。

## Run 级 link 与规划

Runner 先加载 Eval、Experiment、config 与 Agent,再求出所有 selector 与 CLI filter 的实际选择图。
随后对每一条 `Eval × Experiment` 边执行 template 检查:

```text
discovery
  -> selection graph
  -> 省略的 sandbox 归一成空 command-only layer
  -> link 每一条选中的边
  -> 聚合 template-conflict / template-missing / Direct Agent 错误
```

矩阵允许出现多个 template,但不允许任一配对出现零份或两份。
只要一条边非法,整个 Run 在 Provider 文件读取、网络、build 与 Sandbox create 前失败。

`niceeval check <experiment>` 在 pure link 后停止。
`--dry` 与正常运行消费同一份 linked matrix,不重新选择 template。

每个合法配对再把自己的 template 交给它绑定的 Provider planner:

```text
linked pair
  -> 读取本地 Compose / Dockerfile 输入
  -> 确定目标平台与 provider locator
  -> 校验 Agent capability requirement
  -> PlannedSandboxCase
  -> fingerprint
```

planner 只做只读文件与网络读取,不 build、不创建资源。
不同配对的 template 可以由不同 Provider 承接;相同物理输入按 BuildKey 共享构建工作。

planner 与启动器由同一个 `ProviderModule<Plan>` 保持静态类型联系。
planning 产出的 provider 私有 `Plan` 被闭包捕获。
build preparation 与 materialize 都消费这一个值。
core 不把计划降成 JSON 后再 Schema decode，也不把新 plan 逆向拼回旧 Case。

启动函数返回带 `Scope.Scope` 要求的 Effect。
fresh Case 默认在 Scope 退出时整组 stop。
留存路径必须通过显式 release disposition 完成 suspend。
资源不能直接离开 Scope，再依赖调用约定手工清理。

## Eval template 路径

```text
Eval template + Experiment command-only + Agent layer
  -> Eval template 选择 Provider
  -> build / start / ready Sandbox Case
  -> 每条 Attempt:
       reset 到已知 Case 起点
       -> Eval prepare commands(声明顺序)
       -> Experiment prepare commands(声明顺序)
       -> agent.ensure 循环(按 ensure 声明顺序)
       -> State load
       -> 建立 Agent 可归因起点
       -> Agent runtime setup / send / test
       -> Agent teardown / State save
       -> Experiment 已登记 cleanup(逆序)
       -> Eval 已登记 cleanup(逆序)
  -> Provider Case finalizer
```

Terminal-Bench 走这条路径。
Compose Eval 自己选择 Docker Compose Provider;同一 Experiment 不需要知道 Eval 是 Compose、Dockerfile 还是 E2B。

## Experiment template 路径

```text
Experiment template + Eval command-only + Agent layer
  -> Experiment template 选择 Provider
  -> build / start / ready Sandbox Case
  -> 每条 Attempt:
       reset 到已知 Case 起点
       -> Experiment prepare commands(声明顺序)
       -> Eval prepare commands(声明顺序)
       -> agent.ensure 循环(按 ensure 声明顺序)
       -> State load
       -> 建立 Agent 可归因起点
       -> Agent runtime setup / send / test
       -> Agent teardown / State save
       -> Eval 已登记 cleanup(逆序)
       -> Experiment 已登记 cleanup(逆序)
  -> Provider Case finalizer
```

MemoryBench 走这条路径。
Experiment 的 E2B template 与 mempal 检查命令先执行,Eval 的 checkout 随后执行,Agent CLI 最后收敛。

## 为什么 Agent 固定最后

Agent CLI 与 Adapter 配置可以依赖 template 提供的系统能力,也可以依赖 Experiment / Eval 准备的证书、runtime 或目录。
普通题目准备不应依赖某个 Agent Adapter 的私有安装路径,否则同一 Eval 无法更换 Agent。

因此 agent.ensure 循环是准备链最后一道强制屏障。
循环完成 probe、缺失时的 install 与复检后,Runner 才进入 State 与 Agent runtime;作者不能把 Agent 提前,Adapter 也不能暗中替换 template。

## 单一 Attempt prepare 频次

普通作者 command 没有窗口级 scope。
无论 fresh 或 reuse,每条 Attempt 都在进入 Agent 前完整重放两层命令:

```text
fresh: create Case -> author commands -> agent.ensure 循环 -> Agent
reuse: reset Case  -> author commands -> agent.ensure 循环 -> Agent
```

因此命令不能依赖「上一条 Attempt 应该已经运行过我」。
昂贵工具由领域 helper 实现真实检查、缺失时安装、安装后复检;预装 template 只让检查命中,不删除 command。

这项选择刻意放弃窗口专属 command 的表达力:

- 绑定 Case 寿命的资源归 Provider Case;
- 外部状态的 load / save 归 State Feature;
- 无法重复执行、严格每窗口一次的任意 callback 不属于普通 SandboxLayer。

它换来的是作者不需要理解 reset 边界与复用池就能把准备写对。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| 配对 template link | Run 规划期 | Run 规划期 |
| Provider physical plan / fingerprint | Run 规划期 | Run 规划期 |
| Case create / ready | 每 Attempt | 每复用窗口 |
| reset | 唯一 Attempt 进入前 | 每 Attempt 进入前 |
| 两层作者 prepare commands | 每 Attempt | 每 Attempt 重放 |
| agent.ensure 循环(probe、缺失才 install、复检) | 每 Attempt | 每 Attempt 重探,命中快速返回 |
| State load / save | 每 Attempt,按 [State](../state/architecture.md#生命周期与-cadence) 契约 | 每窗口,按 State 契约 |
| Agent runtime / test | 每 Attempt | 每 Attempt |
| command 已登记 cleanup | 每 Attempt 逆序 | 每 Attempt 逆序 |
| Provider finalizer | 每 Attempt | 每复用窗口 |

复用只复用 Provider Case 与允许保留的状态;准备链仍然是每条 Attempt 的可观察事实。
某个检查命令的已安装内容在 reset 后仍然存在时,它的检查会命中;reset 删除了该内容时,当前 Attempt 重新安装,这是正确性结果,不是缓存失败。
reset 语义、寿命确认与污染诊断见 [Sandbox 复用](reuse.md)。

## 准备、State 与 baseline

两层作者 command 和 agent.ensure 循环都属于 Agent 开始前的基础设施活动。
State load 在 Agent CLI 可用后执行;Runner 随后建立本条 Attempt 的 Agent 可归因起点。
无 State 时不产生空 phase;fresh 每 Attempt load/save,复用时每窗口 load/save,完整 cadence 与 save policy 由 [State Architecture](../state/architecture.md#生命周期与-cadence) 定义。

因此:

- 作者 command 写入的题目材料不算 Agent 修改;
- Agent CLI 安装不得把工具文件写进任务 workdir;
- State load 载入的实验条件不算 Agent 修改;
- `test(t)` 在 `send` 窗口外上传的文件仍按 Eval 活动归因;
- 只有 Agent turn 窗口内的变化进入 Agent diff。

Runner 仍记录各活动的实际文件变化,不能靠延后 baseline 隐藏测试泄漏。

## Cleanup

SandboxCommand 在运行中取得临时资源后调用 `context.onCleanup()`。
Runner 只清理本条 Attempt 实际取得的资源,顺序为全局 LIFO:

```text
Agent runtime teardown
  -> State save
  -> 第二作者 layer cleanup(命令逆序)
  -> template owner layer cleanup(命令逆序)
  -> reset / 退休决策
  -> 窗口关闭时 Provider Case finalizer
```

agent.ensure 循环默认不卸载 CLI;临时 payload 由 Agent 安装层与 Runner 的专用 finalizer 处理。
Case 的 service、watcher、日志与 volume 不走 `onCleanup()`,由 Provider Case finalizer 整组关闭。
cleanup 使用独立预算与 signal,不复用已经 abort 的前向 signal;cleanup 失败保留原结果、记录诊断,并在无法证明可恢复时退休复用窗口。

## 身份与复用池

完整 Attempt fingerprint 至少包含:

- template identity、template owner 与 Provider planner revision;
- 物理 locator、BuildKey、CaseKey 与目标平台;
- 固定 layer 顺序;
- 两个作者 layer 的 command identity;
- Agent ensure identity:ensure 声明 identity、配对安装层 identity、payload digest、平台与安装模式;
- Eval、Experiment、Agent、输入与 transfer manifest identity。

同一 Run 中不同配对即使使用相同物理 template,也不能省略 owner 与 layer 顺序。
`command()` / `shell()` 与显式登记 inputs 的 `defineSandboxCommand()` 参与稳定 fingerprint;任一直接 callback 为 opaque 时,该 Attempt `carryEligible = false`。

Sandbox 复用池的键至少固定:

```text
(CaseKey, templateOwner, author layer identities, Agent ensure identity)
```

每条 Attempt 都重放命令,所以池键不把「某条命令已经执行」当作可跳过证据。
含 opaque command 的 layer 没有稳定 layer identity,对应窗口不跨配对、不跨 Invocation 共享。
reset 失败、cleanup 失败或 State Feature 无法恢复已知边界时退休窗口。

## 错误语义

| 失败点 | 结果 |
|---|---|
| 配对两方都带 template | `sandbox.template-conflict`,全矩阵聚合,零 Provider I/O |
| 配对两方都没有 template | `sandbox.template-missing`,全矩阵聚合,零 Provider I/O |
| Direct Agent 搭配 SandboxLayer | `sandbox.unexpected-for-direct-agent` |
| template factory / 平台 / capability 不可用 | physical planning 聚合错误,零 build / create |
| Provider build / start / ready | Attempt `errored`,归 Sandbox Case |
| template owner 的作者 command | Attempt `errored`,归 `sandbox.prepare.<templateOwner>` |
| 第二作者 layer 的 command | Attempt `errored`,归对应 owner 的 `sandbox.prepare` |
| agent.ensure 循环的 probe 配对、install 或复检 | Attempt `errored`,归 `agent.ensure` |
| State load / save | Attempt `errored`,归 `state.load` / `state.save`;状态序列无合法后继时停止该 Experiment 后续派发 |
| command cleanup / Agent teardown | 保留原结果并追加 cleanup 诊断;必要时退休复用窗口 |
| Provider finalizer | 记录 Case cleanup 诊断,不覆盖原始 Attempt 判定 |

## 相关阅读

- [Sandbox Layer](layers.md) —— 作者声明、配对规则与 command identity。
- [Sandbox Case](case.md) —— BuildKey / CaseKey、构建协调与 Compose 义务。
- [Sandbox 复用](reuse.md) —— reset、寿命确认与复用污染诊断。
- [Agent Ensure](../adapters/architecture/agent-ensure.md) —— ensure 声明与 Agent 安装层的协议。
- [State](../state/README.md) —— checkpoint、一致性、save policy 与窗口 cadence。
- [Experiments · 缓存与携带](../experiments/cache.md) —— fingerprint 与 configHash 的完整输入清单。
