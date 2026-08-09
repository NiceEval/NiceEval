# Sandbox 三方准备时序

本篇回答四个运行问题:

1. Eval、Experiment 与 Agent 分别贡献什么。
2. 每个配对怎样在创建资源前确定唯一 template。
3. Case 启动后,三层准备按什么顺序执行,失败归到哪里。
4. `sandboxReuse` 打开后,哪些步骤每复用周期一次,哪些步骤仍然每 Attempt 执行。

作者声明面见 [Sandbox Layer](layers.md);template 之下的完整运行单位见 [Case](case.md)。

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| Eval layer | 可选 template、逐 Attempt 的 SandboxCommand、test | 题目起点、题目准备、Agent 交互与判分 |
| Experiment layer | 可选 template、逐 Attempt 的 SandboxCommand | 实验起点或实验准备 |
| Agent layer | Adapter 的 ensure 声明序列与配对的 Agent 安装层,由 Runner 组装 | CLI identity、探测、payload、平台、安装与复检 |
| Provider Case | template planner、build、start、ready、finalizer | 创建、观测、复用并整组销毁 |

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
  -> SandboxProviderPlan
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
资源不能直接离开 Scope，再依赖调用约定手工销毁。

## Eval template 路径

```text
Eval template + Experiment command-only + Agent layer
  -> Eval template 选择 Provider
  -> build / start / ready Sandbox Case
  -> Sandbox lifecycle setup
  -> 每条 Attempt:
       reset 到已知 Case 起点
       -> Eval prepare commands(声明顺序)
       -> Experiment prepare commands(声明顺序)
       -> agent.ensure 循环(按 ensure 声明顺序)
       -> 建立 Agent 可归因起点
       -> Agent runtime setup / send / test
       -> Agent teardown
       -> Experiment 已登记 cleanup(逆序)
       -> Eval 已登记 cleanup(逆序)
  -> Sandbox lifecycle teardown
  -> Provider Case finalizer
```

Terminal-Bench 走这条路径。
Compose Eval 自己选择 Docker Compose Provider;同一 Experiment 不需要知道 Eval 是 Compose、Dockerfile 还是 E2B。

## Experiment template 路径

```text
Experiment template + Eval command-only + Agent layer
  -> Experiment template 选择 Provider
  -> build / start / ready Sandbox Case
  -> Sandbox lifecycle setup
  -> 每条 Attempt:
       reset 到已知 Case 起点
       -> Experiment prepare commands(声明顺序)
       -> Eval prepare commands(声明顺序)
       -> agent.ensure 循环(按 ensure 声明顺序)
       -> 建立 Agent 可归因起点
       -> Agent runtime setup / send / test
       -> Agent teardown
       -> Eval 已登记 cleanup(逆序)
       -> Experiment 已登记 cleanup(逆序)
  -> Sandbox lifecycle teardown
  -> Provider Case finalizer
```

MemoryBench 走这条路径。
Experiment 的 E2B template 与 mempal 检查命令先执行,Eval 的 checkout 随后执行,Agent CLI 最后收敛。

## 为什么 Agent 固定最后

Agent CLI 与 Adapter 配置可以依赖 template 提供的系统能力,也可以依赖 Experiment / Eval 准备的证书、runtime 或目录。
普通题目准备不应依赖某个 Agent Adapter 的私有安装路径,否则同一 Eval 无法更换 Agent。

因此 agent.ensure 循环是准备链最后一道强制屏障。
循环完成 探测、缺失时的 install 与复检后,Runner 才进入 Agent runtime;作者不能把 Agent 提前,Adapter 也不能暗中替换 template。

## 单一 Attempt prepare 频次

普通作者 command 没有周期级 scope。
无论 fresh 或 reuse,每条 Attempt 都在进入 Agent 前完整执行两层命令:

```text
fresh: create Case -> author commands -> agent.ensure 循环 -> Agent
reuse: reset Case  -> author commands -> agent.ensure 循环 -> Agent
```

因此命令不能依赖「上一条 Attempt 应该已经运行过我」。
昂贵工具由领域步骤实现真实检查、缺失时安装、安装后复检;预装 template 只让检查命中,不删除 command。

这项选择刻意放弃周期专属 command 的表达力:

- 绑定 Case 寿命的资源归 Provider Case;
- 无法重复执行、严格每个物理实例一次的实例动作归 Sandbox lifecycle hooks。

它换来的是作者不需要理解 reset 边界与复用池就能把准备写对。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| 配对 template link | Run 规划期 | Run 规划期 |
| Provider physical plan / fingerprint | Run 规划期 | Run 规划期 |
| Case create / ready | 每 Attempt | 每复用周期 |
| reset | 唯一 Attempt 进入前 | 每 Attempt 进入前 |
| 两层作者 prepare commands | 每 Attempt | 每 Attempt 执行 |
| agent.ensure 循环(探测、缺失才 install、复检) | 每 Attempt | 每 Attempt 重探,命中快速返回 |
| Sandbox lifecycle hooks | 每物理实例一次 | 每台被复用的物理实例一次；纯 Experiment-owned hook 可跨 eval 共用，Eval-owned hook 按 eval 隔离 |
| Agent runtime / test | 每 Attempt | 每 Attempt |
| command 已登记 cleanup | 每 Attempt 逆序 | 每 Attempt 逆序 |
| Provider finalizer | 每 Attempt | 每复用周期 |

复用只复用 Provider Case 与允许保留的状态;准备链仍然是每条 Attempt 的可观察事实。
某个检查命令的已安装内容在 reset 后仍然存在时,它的检查会命中;reset 删除了该内容时,当前 Attempt 重新安装,这是正确性结果,不是缓存失败。
reset 语义、寿命确认与污染诊断见 [Sandbox 复用](reuse.md)。

## 准备、lifecycle 与 baseline

两层作者 command 和 agent.ensure 循环都属于 Agent 开始前的基础设施活动。
Sandbox setup 在物理实例创建后、逐 Attempt prepare 前执行；teardown 在 Agent teardown 与逐 Attempt cleanup 后、provider finalizer 前执行。多个 setup 按追加序，多个 teardown 按追加的逆序；setup 失败也仍执行 teardown，teardown 失败记 diagnostic 后继续收尾。

因此:

- 作者 command 写入的题目材料不算 Agent 修改;
- Agent CLI 安装不得把工具文件写进任务 workdir;
- lifecycle setup 写入的运行条件不算 Agent 修改;
- `test(t)` 在 `send` 区间外上传的文件仍按 Eval 活动归因;
- 只有 Agent turn 区间内的变化进入 Agent diff。

Runner 仍登记各活动的实际文件变化,不能靠延后 baseline 隐藏测试泄漏。

## Cleanup

SandboxCommand 在运行中取得临时资源后调用 `context.onCleanup()`。
Runner 只对本条 Attempt 实际取得的资源执行 cleanup,顺序为全局 LIFO:

```text
Agent runtime teardown
  -> 第二作者 layer cleanup(命令逆序)
  -> template owner layer cleanup(命令逆序)
  -> reset / 退休决策
  -> 物理实例关闭时 Sandbox lifecycle teardown
  -> Provider Case finalizer
```

agent.ensure 循环默认不卸载 CLI;临时 payload 由 Agent 安装层与 Runner 的专用 finalizer 处理。
Case 的 service、watcher、日志与 volume 不走 `onCleanup()`,由 Provider Case finalizer 整组关闭。
cleanup 使用独立预算与 signal,不复用已经 abort 的前向 signal;cleanup 失败保留原结果、写入诊断,并在无法证明可恢复时退休复用周期。

## 身份与复用池

完整 Attempt fingerprint 至少包含:

- template identity、template owner 与 Provider planner revision;
- 物理 locator、BuildKey、CaseKey 与目标平台;
- 固定 layer 顺序;
- 两个作者 layer 中已登记的 command identity 与 lifecycle owner marker;
- Agent ensure identity:ensure 声明 identity、配对安装层 identity、payload digest、平台与安装模式;
- Eval、Experiment、Agent、输入与 transfer manifest identity。

同一 Run 中不同配对即使使用相同物理 template,也不能省略 owner 与 layer 顺序。
`command()` / `shell()` 与显式登记 inputs 的 `defineSandboxCommand()` 参与稳定 fingerprint。直接 callback 与 lifecycle hook 不提供额外 identity，也不阻断携带；其语义变化需要作者通过已登记命令输入或 `--rerun all` 明确表达。

Sandbox 复用池的键只固定物理实例共享所需的输入:

```text
(Provider physical plan identity, Agent ensure identity, lifecycle owner marker)
```

每条 Attempt 都执行命令,所以池键不包含 prepare command 或「某条命令已经执行」的证据。
hook callback 的函数体不进入 fingerprint，也不阻断跨 Run carry。Eval-owned hook 会把同一 Run 的物理实例按 eval 隔离，Experiment-owned hook 不会；hook 语义变化后的复验由作者显式执行 `--rerun all`。
reset 或 cleanup 无法恢复已知边界时退休物理实例。

## 错误语义

下表的 `errored` 是由结构化执行错误通道事件 支撑的 Verdict；它不是 Attempt lifecycle state。受影响的 Attempt 仍只在 `active`、`completed`、`abandoned` 三态中收敛。

| 失败点 | 结果 |
|---|---|
| 配对两方都带 template | `sandbox.template-conflict`,全矩阵聚合,零 Provider I/O |
| 配对两方都没有 template | `sandbox.template-missing`,全矩阵聚合,零 Provider I/O |
| Direct Agent 搭配 SandboxLayer | `sandbox.unexpected-for-direct-agent` |
| template factory / 平台 / capability 不可用 | physical planning 聚合错误,零 build / create |
| Provider build / start / ready | 形成 `errored` Verdict,归 Case |
| template owner 的作者 command | 形成 `errored` Verdict,归 `sandbox.prepare.<templateOwner>` |
| 第二作者 layer 的 command | 形成 `errored` Verdict,归对应 owner 的 `sandbox.prepare` |
| agent.ensure 循环的 探测 配对、install 或复检 | 形成 `errored` Verdict,归 `agent.ensure` |
| Sandbox lifecycle setup | 形成 `errored` Verdict;已创建的物理实例仍依序运行 teardown 后停止 |
| Sandbox lifecycle teardown | 追加 warning diagnostic，继续其余 teardown 并停止 provider |
| command cleanup / Agent teardown | 保留原结果并追加 cleanup 诊断;必要时退休复用周期 |
| Provider finalizer | 使用独立于 Attempt 的有界 cleanup signal；失败写入 `sandbox-stop-failed` Case cleanup diagnostic channel event 并保留可重试/孤儿认领的资源所有权，不改写原始 Verdict |

## 相关阅读

- [Sandbox Layer](layers.md) —— 作者声明、配对规则与 command identity。
- [Case](case.md) —— BuildKey / CaseKey、构建协调与 Compose 义务。
- [Sandbox 复用](reuse.md) —— reset、寿命确认与复用污染诊断。
- [Agent Ensure](../adapters/architecture/agent-ensure.md) —— ensure 声明与 Agent 安装层的协议。
- [Experiments · 缓存与携带](../experiments/cache.md) —— fingerprint 与 configHash 的完整输入清单。
