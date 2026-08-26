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
  -> 比较 Eval layer requirements 与 Provider capability receipt
  -> SandboxProviderPlan
  -> fingerprint
```

nested Docker 的 requirement / capability 比较在 create、模型调用和 Attempt dispatch 之前完成。不满足时返回 `sandbox-capability-unsatisfied`；不回退宿主 socket、raw / managed DinD 或 privileged outer container。`incusSandbox()` 是 DestroyOnly：`--keep-sandbox` 与 `sandboxReuse` 在创建资源前失败。完整时序见 [Nested Docker Lifecycle](nested-docker/lifecycle.md)。

planner 只做只读文件与网络读取,不 build、不创建资源。
不同配对的 template 可以由不同 Provider 承接;相同物理输入按 BuildKey 共享构建工作。

planner 与启动器由同一个 `ProviderModule<Plan>` 保持静态类型联系。
planning 产出的 provider 私有 `Plan` 被闭包捕获。
build preparation 与 Sandbox creation 都消费这一个值。
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
	  -> 每条 Attempt:
	       reset 到 Provider baseline
	       -> occurrence DAG:依赖就绪后按 changeFrequency 从小到大满足 before
       -> agent.ensure 循环(按 ensure 声明顺序)
       -> 建立 Agent 可归因起点
       -> Adapter runtime setup / Agent run / Eval test / runtime teardown
	       -> after / dynamic cleanup(同一实际登记栈 LIFO)
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
	       reset 到 Provider baseline
       -> occurrence DAG:依赖就绪后按 changeFrequency 从小到大满足 before
       -> agent.ensure 循环(按 ensure 声明顺序)
       -> 建立 Agent 可归因起点
       -> Adapter runtime setup / Agent run / Eval test / runtime teardown
	       -> after / dynamic cleanup(同一实际登记栈 LIFO)
	  -> Provider Case finalizer
```

MemoryBench 走这条路径。
Experiment 的 E2B template 只提供起点。mempal、checkout 与 Agent `.env` action 按依赖和 changeFrequency 排队；Agent CLI ensure 在全部 attempt before 满足后收敛。

## 为什么 Agent runtime 固定最后

Agent CLI 与 Adapter 配置可以依赖 template 提供的系统能力,也可以依赖 Experiment / Eval 准备的证书、runtime 或目录。
普通题目准备不应依赖某个 Agent Adapter 的私有安装路径,否则同一 Eval 无法更换 Agent。

因此 agent.ensure 循环是 action schedule 后的一道强制屏障。
Agent-owned before action 不固定最后；高频 `.env` 通常因数值较大自然靠后。循环完成探测、缺失时的 install 与复检后,Runner 才进入 Agent runtime；Adapter 不能暗中替换 template。

## 准备前缀的运行时序

公开 API 统一声明 owner 的 before 与 after，不暴露 scope。link 把全部 attachment 编译为 attempt occurrence；每个 Attempt reset 后满足同一条 before DAG：

```text
fresh: create Case -> reset baseline -> before -> Agent/test -> after
reuse: reset baseline -> before -> Agent/test -> after
```

每个 eligible before occurrence 都产生 satisfaction 事实。hit restore verified private state，action invocation 为零；miss 或 bypass replay；unsupported 真实执行。callback before 和全部 after 不被跳过。author action 固定是 attempt occurrence，不提升为 physical-instance occurrence。

普通 Docker 与 E2B 的正常 `use` 路径按以下顺序满足一个 occurrence：

```text
BuildKey ready
  -> lookup longest verified SetupPrefix
  -> create private staging from exact parent image, E2B snapshot, or Base
  -> for each remaining eligible action:
       replay action
       -> quiesce / commit or snapshot / verify provider artifact
       -> new artifact supersedes the same canonical action lineage's inactive older runtime generation
       -> create next private staging from that exact artifact
  -> create final private writable clone
  -> runtime secret overlay
  -> agent.ensure / Adapter runtime / Agent / Eval test
```

`bypass` 跳过 lookup、capture 与 publication，但保留同一 DAG、identity 与 action replay。在 `use` 下，opaque barrier 之前仍可恢复最长前缀；barrier 执行后不发布任何后缀。runtime secret overlay 必须位于最终私有容器，不能进入 staging 或 cache image。

lookup 或 restore 在 action 执行前失败时，Runner 忽略不可验证的候选，并最多一次从更短可信前缀或 Base 创建干净 Sandbox。剩余 action 真实 replay，反馈为 `degraded`。capture 在 action 成功后失败时不重复该 action；当前状态无法证明完整时让 Attempt 失败。

Incus nested Docker 不在 Attempt 内执行上述 capture。Run 级 prepare coordinator 在派发前查找最深 verified Provider artifact，并从该 artifact 或 exact base 执行剩余业务前缀。每完成一个 SetupPrefix，它就构建、发布新的 Provider artifact。

不同 `SetupPrefixKey` 可以并行。同一 `(executionDomainId, SetupPrefixKey)` 通过跨进程 publication lease 串行发布；等待者消费同一 committed `ArtifactIntent`。每条 Attempt 随后从最终 artifact clone 私有 VM，再真实执行 barrier 后缀、Agent 与 Eval test。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| 配对 template link | Run 规划期 | Run 规划期 |
| Provider physical plan / fingerprint | Run 规划期 | Run 规划期 |
| Case create / ready | 每 Attempt | 每复用周期 |
| reset | 唯一 Attempt 进入前 | 每 Attempt 回到 Provider baseline |
| before | 每 Attempt 满足一次 | 每 Attempt 满足一次 |
| agent.ensure 循环(探测、缺失才 install、复检) | 每 Attempt | 每 Attempt 重探,命中快速返回 |
| after | 每 Attempt 登记栈逆序 | 每 Attempt 登记栈逆序 |
| Agent runtime / test | 每 Attempt | 每 Attempt |
| command 已登记 cleanup | 每 Attempt 逆序 | 每 Attempt 逆序 |
| Provider finalizer | 每 Attempt | 每复用周期 |

复用只复用 Provider Case、Provider baseline 与允许保留的状态。before occurrence 仍是可观察事实,但 cache hit 以 restore 满足,不调用 action。
reset 语义、寿命确认与污染诊断见 [Sandbox 复用](reuse.md)。

## 命令计划怎样投影这条时序

`niceeval debug <experiment> <eval>` 直接消费 link 与 physical planning 的完成态，把本页时序投影为 Experiment → lane → slot。它不读取 Record、reuse、carry 或 cache inventory。装配器拥有生命周期语义；human 的逐节点 `COMMAND PLAN` 区域框和 JSON 的 `commandPlan` 只投影同一棵树，不能各自重排节点。

Provider capacity reservation 是 Provider 创建 Sandbox 的准入条件，不是已经开始创建 Sandbox 的事实。等待 reservation 的 Attempt 保持 queued，并携带 provider-capacity reason；reservation granted 后才进入 `sandbox.create`。等待者不占普通 sandbox semaphore；公平 admission 与可缓存 preparation 都服从本页同一条时序。

它只声明运行器能保证的偏序：fresh Eval 与 `sandboxReuse` lane 都不保证 slot 顺序，也不生成全局序号。Eval Group lane 按规范化 Eval ID、再按 Attempt index 串行。Eval Group 选择只保留命中的成员；作者数组位置没有业务顺序语义。

fresh slot 把 Case create、逐 Attempt body 与 Provider finalizer 放在自己的 steps 内。reuse 与 Eval Group lane 仍可显示 Provider-owned instance boundary；SandboxLayer before/after 不进入该模板，全部按 attempt 执行。reset 失败、寿命不足或故障退休可能更换实例；这不把 author action 自动提升为 physical occurrence。

debug 把配置的全部 attempts 列作候选 dispatch slot。正常运行的 activation 仍受 late carry、预算、early-exit、fail-fast、取消与运行期失败影响；静态列出不等于实际执行。

Sandbox callback、test 与 Provider callback 保留其真实位置并标为 opaque。每个 action node 显示 declarationOrder、dependencies、changeFrequency、occurrence-local topological ordinal、schedulingReason、owner 与 attempt occurrence。

同一节点还显示 phase、作者原始 changeFrequency、安全 fingerprint 和 Provider 的 `persistent | unsupported` capability。debug 不查询 inventory，也不求运行期资格或最终 key；固定显示 runtime `pending`、lookup 与 final key `not-probed`。实际 hit/replay 与 restore source 只进入运行反馈。

`shell()` / `command()` 显示 exact 命令与脱敏后的 env key，普通 callback 只显示 opaque。`sandbox.create` 额外显示 template owner、provider、kind 与安全的 configured locator。

这个 locator 来自 template 声明的私有 command-plan binding，不进入 Record、provider identity 或复用 fingerprint。Direct Agent 显示一个明确的 `known-no-command` create 节点。`preTeardown` 按执行契约逆序展开，并标明只有 setup 到达 postSetup 时点后才运行。

Eval Group 的 `beforeSlots` / `afterSlots` 在 human 与 JSON 中都显式呈现 Eval Group Plugin before / after。Sandbox Plugin fragment 的 action 与 Experiment、Eval Group、Eval、Agent action 进入同一个 DAG；Eval Plugin lifecycle 留在各 dispatch slot 内。它们都按 attachment owner 保留身份，不能因 Plugin 恰好来自同一个 definition 就跨 owner 合并。

把有外部副作用、secret 或会话的 callback 伪装成 eligible shell 只为让预览变 exact 会违反确定性资格,禁止这样改语义。

## 运行反馈、Activity 与 dogfood 门

静态计划只显示 `cacheLookup: "not-probed"`，不能声称 hit。运行时每个 eligible occurrence 的最终 cache 反馈固定为 `hit | replay | unsupported | degraded`。`replay` 的 reason 是 `miss | bypass`；`degraded` 必须同时产生 `cache-degraded` diagnostic，并指向被隔离的 operation id。

普通 Docker 与 E2B 的准备前缀按 Attempt 求值与执行，不建立跨 Attempt physical promotion、跨进程 single-flight 或共享 operation。Incus 在 Provider 中构建、发布 prepared artifact 是派发前的独立协调阶段；它只共享 immutable artifact publication，不共享 Attempt、VM 或可写状态。

Attempt elapsed 只计算本次 queue、restore、action replay、Agent 与 Eval test。持久事实不包含本地 image/container locator、credential value 或 secret bytes。

安装后公开入口的 dogfood 使用同一份固定 fixture，并保留四个可比较切片：

| 切片 | 必须证明 |
|---|---|
| 旧 baseline | 不依赖 SetupPrefix cache 仍得到相同题目起点与判分语义 |
| 冷运行 | BuildKey 按构建输入求值；prefix 为 replay，并为每个 action 写入真实结果 |
| 暖运行 | 相同 BuildKey 与 SetupPrefixKey 可命中；仍真实执行 barrier 之后的 action、Agent 与 Eval test |
| 只改 Eval/test | BuildKey 与未改 before 的 SetupPrefixKey 保持相同并命中；Attempt/result identity 按 Eval 变化，secret overlay、Agent 与 test 仍真实执行 |

验收从安装后的 `niceeval exp`、`niceeval debug` 与公开结果读取这些事实，不直接读取 Docker 私有 cache image。secret overlay 用非敏感 marker 证明执行次数；真实 secret 不进入 fixture 收据、命令计划或 Record。

## 准备、lifecycle 与 baseline

四类 owner 的 before 和 agent.ensure 循环都属于 Agent 开始前的基础设施活动，每次 Attempt 都执行。拥有可用 Sandbox 的 occurrence 进入时登记 standalone after；callback before 成功取得资源后立即登记动态 cleanup。cleanup 在 Adapter runtime teardown 后按实际登记栈全局逆序执行。

因此:

- 作者 command 写入的题目材料不算 Agent 修改;
- Agent CLI 安装不得把工具文件写进任务 workdir;
- before 写入的运行条件不算 Agent 修改;
- `test(t)` 在 `send` 区间外上传的文件仍按 Eval 活动归因;
- 只有 Agent turn 区间内的变化进入 Agent diff。

Runner 仍登记各活动的实际文件变化,不能靠延后 baseline 隐藏测试泄漏。

## Cleanup

SandboxCommand 在运行中取得临时资源后调用 `context.onCleanup()`。
Runner 只对本条 Attempt 实际取得的资源执行 cleanup,顺序为全局 LIFO:

```text
	Agent runtime teardown
	  -> after / command cleanup(实际登记栈逆序)
	  -> reset / 退休决策
	  -> Provider Case finalizer
```

agent.ensure 循环默认不卸载 CLI;临时 payload 由 Agent 安装层与 Runner 的专用 finalizer 处理。
Case 的 service、watcher、日志与 volume 不走 `onCleanup()`,由 Provider Case finalizer 整组关闭。
cleanup 使用独立预算与 signal,不复用已经 abort 的前向 signal;cleanup 失败保留原结果、写入诊断,并在无法证明可恢复时退休复用周期。

## 身份与复用池

完整 Attempt fingerprint 至少包含:

- template identity、template owner 与 Provider planner revision;
- provider plan identity、BuildKey、CaseKey 与目标平台；不含每次创建的实例 locator；
- 固定 layer 顺序;
- 四类 owner layer 中已登记的 action、command 与 after identity;
- Agent ensure identity:ensure 声明 identity、配对安装层 identity、payload digest、平台与安装模式;
- Eval、Experiment、Agent、输入与 transfer manifest identity。

同一 Run 中不同配对即使使用相同物理 template,也不能省略 owner 与 layer 顺序。
`command()` / `shell()` 与声明式 action 参与稳定 fingerprint。直接 callback 与 `defineSandboxCommand()` 是 opaque barrier；其语义变化需要作者通过已登记输入或 `--rerun all` 明确表达。

Sandbox 复用池的键只固定物理实例共享所需的输入:

```text
(Provider plan identity, Provider reset baseline identity, Agent ensure identity)
```

池键包含 Provider reset baseline identity。callback 函数体不进入 fingerprint；opaque marker 与 attachment owner 进入 identity 并截断共享捕获。before 仍在每条 Attempt 内满足。

Sandbox Plugin 的 attachment owner、name、instance key、声明 fingerprint、顺序与 before/after 形状同时进入完整 Attempt fingerprint。任一声明身份变化都会让历史结果 carry 失配并产生 fresh slot；callback 函数体仍是 opaque，行为变化时必须同步修改声明 fingerprint 或使用 `--rerun all`。

Sandbox Plugin fragment 与四类 owner 的 action 进入同一个 DAG，不创建物理生命周期。callback 语义变化后的复验由作者显式执行 `--rerun all`。reset 或 cleanup 无法恢复已知边界时退休物理实例。

## 错误语义

下表的 `errored` 是由结构化 Observability execution diagnostic 支撑的 Verdict；它不是 Attempt lifecycle state。受影响的 Attempt 仍只在 `active`、`completed`、`abandoned` 三态中收敛。

| 失败点 | 结果 |
|---|---|
| 配对两方都带 template | `sandbox.template-conflict`,全矩阵聚合,零 Provider I/O |
| 配对两方都没有 template | `sandbox.template-missing`,全矩阵聚合,零 Provider I/O |
| Direct Agent 搭配 SandboxLayer | `sandbox.unexpected-for-direct-agent` |
| template factory / 平台 / capability 不可用 | physical planning 聚合错误,零 build / create |
| Provider build / start / ready | 形成 `errored` Verdict,归 Case |
| owner before action | 形成 `errored` Verdict,归 `sandbox.before.<owner>` |
| 第二作者 layer 的 action | 形成 `errored` Verdict，归对应 owner 的 `sandbox.before` |
| agent.ensure 循环的 探测 配对、install 或复检 | 形成 `errored` Verdict,归 `agent.ensure` |
| command cleanup / Agent teardown | 保留原结果并追加 cleanup 诊断;必要时退休复用周期 |
| Provider finalizer | 使用独立于 Attempt 的有界 cleanup signal；失败写入 `sandbox-stop-failed` Case cleanup Observability diagnostic 并保留可重试/孤儿认领的资源所有权，不改写原始 Verdict |

## 相关阅读

- [Sandbox Layer](layers.md) —— 作者声明、配对规则与 command identity。
- [Case](case.md) —— BuildKey / CaseKey、构建协调与 Compose 义务。
- [Sandbox 复用](reuse.md) —— reset、寿命确认与复用污染诊断。
- [Agent Ensure](../adapters/architecture/agent-ensure.md) —— ensure 声明与 Agent 安装层的协议。
- [Experiments · 缓存与携带](../experiments/cache.md) —— fingerprint 与 configHash 的完整输入清单。
