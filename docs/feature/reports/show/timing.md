# `--timing`：整个 attempt 的统一时间树

`--timing` 是 attempt-detail 组件族对应区块的 text 面。[首页](attempt.md)的 `timing:` 行给出逐阶段一行的完整摘要（子节点只是折叠成计数，阶段本身不筛选）；`--timing` 是整个 Attempt 的时间分析入口，展开首页折叠掉的子节点。它先按 `result.json.phases` 输出 runner 生命周期，再投影 runner 直接观察到的时间树：setup/teardown hook、经 `Sandbox.runCommand()` / `runShell()` 发出的命令、runner 拥有的语义 operation，以及 `eval.run` 中每个 session/turn 的 send 墙钟包络。某个 turn 带 `traceId` 时，消费方再从 `trace.json` 把该轮的 agent/model/tool spans 挂到 turn 下；没有 OTel 时 phase、hook、operation、命令和 turn 时间仍完整，只有轮内 OTel 子树缺席。

时间分析入口有两档密度，都是这个区块 text 渲染面的选项，不是事实过滤器；`--json` 面恒为完整 resolve 产物，等价 `--timing=full` 的节点集合，不受 detail node 预算约束（[切片是组件选择](../architecture.md#show-的切片是组件选择)）：

- 裸 `--timing` 是**有界诊断投影**。所有实际存在的 lifecycle phase 与收尾 phase 都必须出现；phase 下的 runner child 与已关联 OTel span 共用 80 个 detail node 的全局预算。未超过预算时，它与 full 输出相同；超过预算时，优先保留失败路径、最慢节点及首尾时序样本，并在每棵被截断的子树原位写明省略节点数、其中的失败数和 full 命令。
- `--timing=full` 逐节点展开 artifact 中全部 runner timing node 与能唯一挂接到 turn 的全部 OTel span，不受 detail node 预算限制。它是审计、脚本取证和检查 renderer 摘要是否诚实的入口；输出很长是允许的。

预算按**节点**而不是终端物理行计算，phase 行与 `… N nodes omitted` 提示不占预算。80 个节点分成四个稳定选择池：失败路径最多 40 个节点、最慢路径最多 20 个节点、全局时序最早与最晚各最多 10 个节点；选中一个深层节点时，其祖先路径一并保留并占用所在池的额度，四个池合并时去重。失败按 `startOffsetMs` / `id` 定序；最慢节点按 `durationMs` 降序并以 `startOffsetMs` / `id` 打破平局；首尾样本按 `startOffsetMs` / `id` 定序。某个池装不下时按自己的稳定次序截断，省略提示如实带出未展示的失败数；某个池没有用满时，空余额度依次交给失败、最慢、首尾池继续选择。renderer 不计算或显示 omitted children 的耗时合计，因为 sibling 可能并发；父节点自身的墙钟才是这棵子树可靠的时间包络。

`--timing` 与 [`--execution`](execution.md) 可以显示同一个 tool span，但投影不同：前者把它放在「phase → turn → agent/model/tool」的时间树中用于找慢点，后者把它贴在对应事件旁用于理解上下文。两者都只消费同一份 span，不复制也不改写事实。

```text
$ niceeval show @1qrdcfq8 --timing
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · ✗ failed

╭─ timing ───────────────────────────────────────────────────────── total 50.0s ─╮
│ sandbox.queue          0.2s                                                    │
│ sandbox.create         5.6s                                                    │
│ sandbox.setup          3.5s                                                    │
│   ├─ warmModelCache        2.9s                                                │
│   │  ├─ shell · mkdir -p ~/.cache/model       0.1s                             │
│   │  └─ shell · restore-model-cache           2.8s                             │
│   └─ setup#2               0.6s                                                │
│      └─ shell · pnpm config set store-dir …   0.6s                             │
│ workspace.baseline     0.1s                                                    │
│   └─ shell · git init && git commit …          0.1s                            │
│ agent.setup           12.1s                                                    │
│   ├─ shell · npm install -g @openai/codex…    10.8s                            │
│   ├─ shell · mkdir -p ~/.codex                 0.1s                            │
│   └─ shell · codex plugin install …            1.2s                            │
│ telemetry.configure    0.1s                                                    │
│   └─ shell · append ~/.codex/config.toml       0.1s                            │
│ eval.run              26.3s                                                    │
│   └─ turn1                22.4s                                                │
│      └─ shell · codex exec …                  22.1s                            │
│         ├─ agent · codex.exec                 22.0s  OTel                      │
│         ├─ model · chat                       14.8s  OTel                      │
│         └─ tool · shell                        3.2s  OTel                      │
│ workspace.diff         0.3s                                                    │
│   └─ operation · export workspace diff · 1 window · 2 files  0.3s              │
│      └─ shell · export ledger window …                         0.3s            │
│ scoring.evaluate       1.4s                                                    │
│ telemetry.collect      0.3s                                                    │
├─ teardown ────────────────────────────────────────────── not counted in total ─┤
│ agent.teardown         0.2s                                                    │
│ sandbox.teardown       0.1s                                                    │
│   └─ persistCache          0.1s                                                │
│      └─ shell · tar czf …                      0.1s                            │
│ sandbox.stop           0.5s                                                    │
╰──────────────────────────────────────── niceeval show @1qrdcfq8 --timing=full ─╯
```

整棵树是一个 `Section`，按[区域框](../library/layout.md#区域框text-面的框线体裁)套一个外框：总耗时嵌上边框右侧，`--timing=full` 嵌下边框，收尾段作为嵌套 `Section` 降为 `├─ teardown ─┤` 隔条。树内每个节点不各自画框——`├─` `└─` 已经表达了层级，逐节点加框只会与它打架。

缩进表达包含关系而不是可相加的账本：hook 包含命令，turn 包含启动 Agent CLI 的命令，OTel span 又可能嵌套或并发；子项不能求和后与父项比较。runner 节点使用本机单调时钟，OTel 节点使用 span 自带时钟，跨进程只按 `traceId` / parent span 关系归属，不按绝对时间硬对齐。主链各阶段之和小于等于 `total`，差值是阶段间的粘合代码，不单独列行。

## operation 提供语义，renderer 只负责通用投影

一个由 runner、Sandbox 或 provider 自己拥有的逻辑工作，如果内部会批量处理很多对象或执行多个低层步骤，采集端应记录一个 `kind: "operation"` 的父节点。`label` 在采集时就写成有界的人读摘要，例如 `export workspace diff · 1 window · 3,302 files`；实际经过公开 Sandbox 边界的命令仍作为它的 `command` child 留下。批量工作应在 Sandbox 内一次完成一个逻辑批次，不能先制造逐文件远端调用，再指望 renderer 把性能问题藏起来。

artifact 不保存 render callback，renderer 也不解析 `git show ...`、`cat-file ...` 或其它 shell 文本来猜 command family。这样既不把 git/ledger 细节塞进通用 Reports，也不会把路径不同的真实调用误合并成一个虚构步骤。语义压缩来自 producer 写下的 operation；renderer 面对任意未知节点只使用统一的预算、失败、耗时和时序规则。

`show` 在 TTY、管道、CI 与 coding agent 环境使用同一选择规则，不因是否交互而改变节点集合，也不自动启动 pager。需要翻页时由用户显式运行 `niceeval show @loc --timing=full | less -R`；CLI 不能像 `git log` 那样在 TTY 下擅自进入一个会等待输入的进程。

## 大时间树的输出 case

**Case 1：小树。** detail node 不超过 80 时，裸 `--timing` 不插入省略行，内容与 `--timing=full` 相同。

**Case 2：producer 已记录批量 operation。** 即使 operation 处理 3,302 个文件，也只展示逻辑工作和真实的批量 Sandbox 边界，不按文件制造 3,302 行：

```text
workspace.diff      1.8s
  └─ operation · export workspace diff · 1 window · 3,302 files  1.8s
     └─ shell · export ledger window …                            1.8s
```

**Case 3：旧 artifact 或自定义 hook 含数千个 child。** 默认视图保留诊断样本并诚实标出省略；full 模式才逐条展开：

```text
$ niceeval show @16nhdz6b --timing
workspace.diff    14m 58s
  ├─ shell · git show …/urllib3/contrib/socks.py       662ms
  ├─ shell · git cat-file -s …                         641ms
  ├─ shell · git show …/urllib3/contrib/securetransport.py  534ms
  └─ … 3,302 nodes omitted (0 failed)
     full: niceeval show @16nhdz6b --timing=full
```

renderer 不把这些行命名为 `git show ×N`：只有 producer 明确记录的 operation 才能提供这种业务语义。旧 artifact 的几千条命令仍是一次真实的 O(files) 调用证据，full 模式必须原样可查。

**Case 4：巨大异构树中有失败。** 失败节点及其祖先路径先占预算；其它位置仍按最慢与首尾规则取样。省略行写 `(N failed)`，所以失败多到预算装不下时也不会冒充“其余全成功”。

**Case 5：并发 sibling。** 选取最慢节点只比较各节点自己的 `durationMs`，省略行不写 `combined 12m` 一类加总；两个各 10 秒、同时运行的 command 仍由父节点显示约 10 秒墙钟，而不是 20 秒。

**Case 6：OTel 子树很大。** 已关联 span 与 runner child 共用默认预算，失败 span 与慢 span参与同一优先级；`--timing=full` 展开全部已关联 span。唯一关联不上的 span 不为了凑树而猜父级，仍由 trace artifact 回答。

**Case 7：没有 phase timing。** 裸模式和 full 模式都输出 `phase timing unavailable`，不会把 events、trace 或 Attempt 总耗时反推成伪 phase。

**Case 8：非交互输出。** 重定向到文件或管道时仍使用 80-node 默认预算；只有显式 `--timing=full` 才解除限制。CLI 不读取 stdin，不因 pager 等待而挂住 agent/CI。

errored 或超时的 attempt 里，`--timing` 直接标出死在哪一步——最后一条主链阶段以及已知的最深 child 带 `✗`，其后没有主链条目；沙箱从未创建成功时收尾段整段缺席。`sandbox.create` 发生在 Sandbox 对象存在之前，只有 provider 主动提供步骤时才展开 SDK 请求或宿主命令；没有细分时只显示可靠的阶段合计：

```text
$ niceeval show @12h8m4k1 --timing
@12h8m4k1 · memory/agent-029-use-cache · compare/claude-e2b · errored
total 2m 8s

sandbox.queue        1.2s
sandbox.create     2m 6s ✗ failed here (sandbox-rate-limit)
```

收尾阶段的 `✗` 独立于判定：一个 passed attempt 也可以带一条失败的 `sandbox.teardown`，对应它的 teardown diagnostic。落盘没有 `phases` 时输出 `phase timing unavailable` 并说明该结果不是由带阶段计时的 runner 产出。`--timing=<mode>` 只接受 `summary` 与 `full`，裸 `--timing` 等价于 `--timing=summary`；其它值按用法错误退出非零，不静默回退。

## 相关阅读

- [`--execution`](execution.md) —— 同一批 span 的事件上下文投影。
- [失败诊断首页](attempt.md) —— `timing:` 一行摘要的家。
- [Phase Timings 与安装基准](../../../engineering/benchmark/README.md) —— 阶段口径与消费方式。
