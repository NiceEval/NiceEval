# `niceeval show` —— 在终端读结果

`niceeval show` 不运行 eval，只读取结果根。它适合在 shell 或 coding agent 循环里快速回答三个问题：哪一题失败、失败的实际值是什么、下一步该看哪份证据。

## 从榜单下钻到 attempt

```sh
niceeval show                              # 当前结果的默认 ExperimentComparison
niceeval show memory/swelancer             # 按 eval id 前缀收窄
niceeval show @1qrdcfq8                    # 打开一个 attempt 的诊断首页
niceeval show @1qrdcfq8 --eval             # 断言标回 eval 源码
niceeval show @1qrdcfq8 --execution        # 对话与工具调用；可关联时附 OTel 时间
niceeval show @1qrdcfq8 --timing           # 有界诊断时间树：生命周期、hook、命令、轮次与 OTel
niceeval show @1qrdcfq8 --timing=full      # 逐节点展开同一棵完整时间树
niceeval show @1qrdcfq8 --diff             # workspace 改动摘要
niceeval show @1qrdcfq8 --diff=path/to.ts  # 某个文件的完整 diff
niceeval show memory/swelancer --history   # 这个 eval 的真实执行历史
```

榜单中的 `@<locator>` 是 attempt 的稳定引用。它必须带 `@`，既不是数组下标也不是文件路径。把 locator 复制给后续命令，便可从汇总数字回到同一次执行的证据。

## 裸 `show`：默认报告的 text 面

裸 `niceeval show` 与显式渲染内置 `ExperimentComparison` 等价。Selection 命中多个可比组时，报告只输出组索引和可直接复制执行的 `niceeval show --experiment <group>` 命令；Selection 已经只剩一个组时，才输出该组的成本 × 端到端成功率散点图与 `ExperimentList`。experiment id 的父目录是组边界：`compare/*` 与 `dev-e2b/*` 不能共享坐标系、连线、排序或汇总数字；根目录 experiment 各自形成单例组。端到端成功率的分母包含 `failed` 与 `errored`，只有 `skipped` 不进入；因此执行错误会降低默认成功率，但仍在结果构成中单独显示，不与失败混成一种判定。单组只有一个可画 experiment 时也照常显示一个点，不要求至少两个实验。

可比组索引一行一个组，显示 experiment / eval 数、`GroupSummary` 的 eval 级通过率、结果构成、成本与最后运行时间；不在 text face 里重算比例。多组 Selection 到此结束，不把所有组的详情一次性倾倒到终端。单组 `ExperimentList` 保持实体层级：一个 experiment 下列 Eval，一个 Eval 下再列它的全部 Attempt。不能把组拍平，也不能把 Eval 与 Attempt 压平成一张“每行一个 Attempt、重复 Eval id”的表。Selection 只剩一个组时省略索引，直接进入该组。

```sh
$ niceeval show
WARNING  snapshot dev-e2b/codex-e2b @ 2026-07-12T10:08:29.361Z is unfinished;
         8 completed attempts are shown, but the snapshot may be incomplete.

实验组                  实验   Eval   Eval 通过率    结果              预估成本   最后运行
compare                    2      6          75.0%   9 通过 / 3 失败      $1.42   2026-07-12 18:08
dev-e2b                    3      6          61.1%   11 通过 / 5 失败     $0.31   2026-07-12 18:09

查看组内详情：
  niceeval show --experiment compare
  niceeval show --experiment dev-e2b
```

```sh
$ niceeval show --experiment dev-e2b

实验组 dev-e2b

平均每个 eval 成本（越低越好） × 端到端成功率
... A

越靠右上越好
A dev-e2b/codex-e2b

实验                    模型            Agent   平均耗时   端到端成功率   结果               Tokens    预估成本
dev-e2b/codex-e2b      gpt-5.4-mini    codex   1m 58s    66.7%   4 通过 / 2 失败    198.9k    $0.17
6 道题 · 6 次 attempt · 2026-07-12T10:08:29.361Z

dev-e2b/codex-e2b
状态      题目 / Attempt                          结果                                      耗时      成本
✓ 通过    memory/agent-037-updatetag-cache
  ✓       └─ @160iuj3h                            —                                         2m 0s     $0.09
✓ 通过    memory/repomod-hello-world-api
  ✓       └─ @1sxmo0m1                            —                                         2m 58s    $0.57
✗ 失败    memory/swelancer-manager-proposals
  ✗       └─ @1qrdcfq8                            equals(4) · expected 4, received 3          50.0s     $0.05
✓ 通过    memory/terminal-cancel-async-tasks
  ✓       └─ @1pcdj0az                            —                                         2m 48s    $0.13
✗ 失败    memory/terminal-pypi-server
  ✗       └─ @13wrnsc4                            command exited 1 · commandSucceeded()      2m 53s    $0.19
✓ 通过    memory/tool-call-observability
  ✓       └─ @18etnsw5                            —                                         18.1s     $0.02
```

同一个 Eval 有重试时，只出现一个 Eval 标题，下面按 attempt 序号逐条列 locator、该 Attempt 自己的判定，以及耗时 / 成本或失败原因：

```text
✓ 通过    memory/flaky-retry
  ✗       ├─ @1first01                            expected ready, received pending            18.0s     $0.02
  ✓       └─ @1second2                            —                                           21.4s     $0.03
```

locator 只打印 `@<id>` 与 verdict，不追加证据能力缩写。Result 单元格使用 [Scoring 定义的主失败断言摘要](../scoring/library/display.md#主失败断言怎样选)：passed attempt 固定为 `—`；failed attempt 只显示一条主失败及可选的 `+N more failures`；errored 显示结构化 error 的一层摘要。绝不把该 attempt 的全部 assertion name 拼进表格——即使有几十条 assertions，一条 Attempt 子行也最多占两行。locator 本身就是证据入口；打开 Attempt 后再列完整断言与实际可执行的证据命令。

Result 单元格的值一律按 [display 的两步压缩](../scoring/library/display.md#契约一结果摘要)先折成单行、再按宽度截断，`received` 携带整段命令输出时也不例外：一条 `commandSucceeded()` 失败塌成 `exit 1 · "…尾部"`，而不是把几百行 stdout 逐行铺进表。落盘的 256 KiB 上限保护 artifact 体积，不替代这层单元格截断——单元格要的是能一眼扫读的预览：

```text
✗ 失败    memory/terminal-pypi-server
  ✗       └─ @1y0e4yh2                            commandSucceeded() · exit 1 · "…test_api F · 1 failed, 0 passed"   4m 23s   $0.29
```

被折掉的完整 stdout 不丢：`niceeval show @1y0e4yh2 --execution` 里那条命令的 result 卡片保留原始换行,`events.json` 存全量（超 256 KiB 才带 `truncated` 标记）。表格从不为了「保全输出」而无限换行。

## 失败诊断首页

无 flag 打开 attempt 时，输出先给判定，再按结果分节列断言：`failures:`（gate 失败）、`soft below threshold:`（soft 未达标）、`scores:`（无阈值 judge 的纯打分）、`unavailable:`（证据评不了，带 reason）——全通过的节省略。每条列分组、matcher、期望值、实际值和源码位置；逐断言家族的渲染示例单点定义在 [Scoring · 断言与 Turn 的展示](../scoring/library/display.md)：

```text
$ niceeval show @1qrdcfq8
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · failed
snapshot 2026-07-12T10:08:29.361Z · attempt 1 · 50.0s · 58.5k tokens · $0.05

assertions: 3 passed · 1 gate failed
eval source: evals/memory/swelancer-manager-proposals.eval.ts · sha256:ee33b9c4…

failures:
  gate · Issue 15193: selected proposal matches the accepted proposal
    assertion: equals(4)
    expected: 4
    received: 3
    source: evals/memory/swelancer-manager-proposals.eval.ts:40:11

execution: 12 events · 0 skill loads · 7 tool calls · 4 AI messages
timing: sandbox.queue 0.2s · sandbox.create 5.6s · sandbox.setup 3.5s · agent.setup 12.1s ·
        eval.run 26.3s · workspace.diff 0.3s · scoring.evaluate 1.4s · teardown +0.8s

changes: 2 files changed by agent · M manager_decisions.json · A notes/decision-log.md

artifacts: .niceeval/dev-e2b_codex-e2b/<snapshot>/memory/swelancer-manager-proposals/a0/
available:
  niceeval show @1qrdcfq8 --eval
  niceeval show @1qrdcfq8 --execution
  niceeval show @1qrdcfq8 --timing
  niceeval show @1qrdcfq8 --diff
```

这页应当足以判断“为什么失败”。只有实际可用的命令才出现在 `available`；没有捕获某类证据时省略对应命令。只有在需要理解断言上下文、agent 为什么给出这个结果、或具体改了什么时，才继续打开证据切面。

`timing:` 行是 `result.json` 里 `phases` 的一行摘要，阶段名就是 `LifecyclePhase` 闭集里的名字：主链阶段按执行序列出，为保持一行可读只列耗时可见的大头（`workspace.baseline`、`telemetry.*` 这类极短阶段并入 `--timing` 的完整分解）；收尾段合计成一个 `teardown +N` 尾项——收尾不计入 attempt 总耗时，所以用 `+` 与主链区分。落盘没有 `phases`（旧结果或第三方 harness 写入）时这一行如实输出 `phase timing unavailable`，不猜。

`errored` attempt 的首页不用 trace 也必须能解释基础设施错误。它先显示结构化 error 的 phase、code、message 与有限 cause,再列本 attempt 的 diagnostics;stack 放在后面并保持原始换行。error 的 `phase`、diagnostics 的 phase 与 `timing:` 行用的是同一套 `LifecyclePhase` 名字,同一次失败在三处叫同一个名:

```text
$ niceeval show @12h8m4k1
@12h8m4k1 · memory/agent-029-use-cache · compare/claude-e2b · errored

error:
  phase: sandbox.create
  code: sandbox-rate-limit
  message: E2B sandbox allocation failed after 5 attempts
  cause: RateLimitError · too many concurrent sandboxes

diagnostics:
  warning · sandbox.create · fallback-region
    Primary region was unavailable; retried in us-west (2 occurrences)

execution: unavailable (attempt failed before telemetry was configured)
timing: sandbox.queue 1.2s · sandbox.create 2m 6s ✗ failed here
```

diagnostic 的 level 不等于 verdict:一个 passed/failed attempt 也可以带 cleanup warning。榜单只显示致命 error 的一层原因;diagnostics、cause 和 stack 留在 locator 首页,避免几十个并发 sandbox 错误淹没终端。

## `--eval`：把断言放回源码

`--eval` 显示运行时保存的 eval 源码，而不是工作树中可能已经修改过的文件。两类调用行有标注：

- **断言行**：通过与失败断言标在对应行；失败行紧跟分组、matcher、期望值和实际值。期望值与实际值经摘要收口（折单行、设上限）——标注是源码页里的一行事实，完整值在 attempt 首页与 `events.json` / `diff.json`。
- **send 行**：`t.send(...)` 的调用行标注它产生的 turn 的头行事实——身份（`s<session>/t<turn>`，与 `--execution` 的 turn 头行、`--timing` 的 turn 节点、diff 的 `windows` 同一套标签）、status、该轮墙钟与该轮 usage（有记录才出现），失败轮标 `✗`。一行源码触发多轮（循环里 send）时逐轮标注。回复全文与轮内工具卡片不内联——源码视图回答「这行代码对应哪一轮、这一轮成了没成」，「这一轮做了什么」归 `--execution`。

```text
26      await t
27✓       .send(
    s1/t1 · completed · 3m 11s
38      for (const [issue, label] of Object.entries(expected)) {
39        await t.group(`Issue ${issue}: selected proposal matches the accepted proposal`, async () => {
40✗         t.check(Number(decisions[issue]?.selected_proposal_id), equals(label.selected_proposal_id));
    gate · Issue 15193: selected proposal matches the accepted proposal ·
    equals(4) · expected 4 · received 3
41        });
42      }
```

send 行的定位来自事件流里用户消息的源码位置，标注在能定位到行的轮上尽力而为：attempt 在事件记录建立前失败、或 send 发生在别的源码文件里时，该轮没有这条标注，断言标注照常；轮次全量清单永远在 `--execution`。断言的 never-drop 契约（unmapped 桶）不适用于 send 标注——断言的诊断面就是 `--eval`，轮次的诊断面是 `--execution`，源码页上的 turn 标注只是跨面指针。

被收口的值必须有「更进一步」：有未通过断言时，`--eval` 末尾在 `full eval source` 之前给出 `full failure detail: niceeval show @<locator>`——attempt 首页把每条失败的 expected / received 按原始换行完整展开（含 `commandSucceeded()` 的 `output tail:` 段），再往下是 `result.json` / `events.json`。收口只压缩展示面，不切断取证链。

长行会截断，末尾的 `full eval source` 给出取全文的两步路径：attempt 级 `sources.json` 是 `{path, sha256}` 引用列表，正文按哈希存在快照级 `sources/<sha256>.json`（见 [Results · sources.json](../results/architecture.md#sourcesjson)）；脚本消费直接用 `AttemptHandle.sources()` 拿拼好的 `{path, content}`，不用自己做两步解析。

## `--execution`：看 agent 做了什么

对话按轮分段、轮内按时间线卡片显示，而不是把长内容塞进表格。表格适合短、同构字段；prompt、命令和 stdout 都可能多行且很长，卡片能保留阅读顺序，也便于复制命令和结果。每轮以 turn 头行开始：身份（`s<session>/t<turn>`，与 `--timing` 的 turn 节点、diff 的 `windows` 同一套标签）、Turn status、该轮墙钟与 usage；逐卡片语法与 waiting / failed / DATA 卡片的示例见 [Scoring · 断言与 Turn 的展示](../scoring/library/display.md#turntsend的展示)：

```text
TURN s1/t1 · completed · 22.4s · 12.4k tok · $0.02
  USER
    You are the engineering manager for this project. ...

  ASSISTANT
    I’m going to inspect the task layout and the decision format first ...

  TOOL · command_execution  +12.8s · 1.3s
    input
      /bin/bash -lc 'find . -maxdepth 2 -type d | sort'
    result · completed · exit 0
      .
      ./.git
      ./tasks
```

`+12.8s` 是相对本次 trace 起点的位置，`1.3s` 是唯一关联到这条事件的 OTel span 耗时；没有可唯一关联的 span 时，这两个时间都省略，事件本身仍照常显示。主时间线只保留用户消息、assistant 消息、skill、subagent 与工具调用。没有关联到这些步骤的 telemetry 不混进对话；末尾会报告省略数量，并给出完整 `trace.json` 路径：

```text
total 50.0s · 0 skill loads · 7 tool calls · 4 AI messages
full events: .niceeval/.../events.json
69 unlinked telemetry spans omitted; inspect the OTel trace for full agent timing.
full OTel trace: .niceeval/.../trace.json
```

`--execution` 以「做了什么」为主，时间只是事件旁的上下文注释；它不负责阶段聚合，也不把未关联 span 猜到某条事件上。要从整个 attempt 回答「时间花在哪里」，使用 `--timing`。

## `--timing`：整个 attempt 的统一时间树

首页的 `timing:` 行回答「大头在哪」；`--timing` 是整个 Attempt 的时间分析入口。它先按 `result.json.phases` 输出 runner 生命周期，再投影 runner 直接观察到的时间树：setup/teardown hook、经 `Sandbox.runCommand()` / `runShell()` 发出的命令、runner 拥有的语义 operation，以及 `eval.run` 中每个 session/turn 的 send 墙钟包络。某个 turn 带 `traceId` 时，消费方再从 `trace.json` 把该轮的 agent/model/tool spans 挂到 turn 下；没有 OTel 时 phase、hook、operation、命令和 turn 时间仍完整，只有轮内 OTel 子树缺席。

时间分析入口有两档密度：

- 裸 `--timing` 是**有界诊断投影**。所有实际存在的 lifecycle phase 与收尾 phase 都必须出现；phase 下的 runner child 与已关联 OTel span 共用 80 个 detail node 的全局预算。未超过预算时，它与 full 输出相同；超过预算时，优先保留失败路径、最慢节点及首尾时序样本，并在每棵被截断的子树原位写明省略节点数、其中的失败数和 full 命令。
- `--timing=full` 逐节点展开 artifact 中全部 runner timing node 与能唯一挂接到 turn 的全部 OTel span，不受 detail node 预算限制。它是审计、脚本取证和检查 renderer 摘要是否诚实的入口；输出很长是允许的。

预算按**节点**而不是终端物理行计算，phase 行与 `… N nodes omitted` 提示不占预算。80 个节点分成四个稳定选择池：失败路径最多 40 个节点、最慢路径最多 20 个节点、全局时序最早与最晚各最多 10 个节点；选中一个深层节点时，其祖先路径一并保留并占用所在池的额度，四个池合并时去重。失败按 `startOffsetMs` / `id` 定序；最慢节点按 `durationMs` 降序并以 `startOffsetMs` / `id` 打破平局；首尾样本按 `startOffsetMs` / `id` 定序。某个池装不下时按自己的稳定次序截断，省略提示如实带出未展示的失败数；某个池没有用满时，空余额度依次交给失败、最慢、首尾池继续选择。renderer 不计算或显示 omitted children 的耗时合计，因为 sibling 可能并发；父节点自身的墙钟才是这棵子树可靠的时间包络。

`--timing` 与 `--execution` 可以显示同一个 tool span，但投影不同：前者把它放在「phase → turn → agent/model/tool」的时间树中用于找慢点，后者把它贴在对应事件旁用于理解上下文。两者都只消费同一份 span，不复制也不改写事实。

```text
$ niceeval show @1qrdcfq8 --timing
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · failed
total 50.0s

sandbox.queue          0.2s
sandbox.create         5.6s
sandbox.setup          3.5s
  ├─ warmModelCache        2.9s
  │  ├─ shell · mkdir -p ~/.cache/model       0.1s
  │  └─ shell · restore-model-cache           2.8s
  └─ setup#2               0.6s
     └─ shell · pnpm config set store-dir …   0.6s
workspace.baseline     0.1s
  └─ shell · git init && git commit …          0.1s
agent.setup           12.1s
  ├─ shell · npm install -g @openai/codex…    10.8s
  ├─ shell · mkdir -p ~/.codex                 0.1s
  └─ shell · codex plugin install …            1.2s
telemetry.configure    0.1s
  └─ shell · append ~/.codex/config.toml       0.1s
eval.run              26.3s
  └─ turn s1/t1           22.4s
     └─ shell · codex exec …                  22.1s
        ├─ agent · codex.exec                 22.0s  OTel
        ├─ model · chat                       14.8s  OTel
        └─ tool · shell                        3.2s  OTel
workspace.diff         0.3s
  └─ operation · export workspace diff · 1 window · 2 files  0.3s
     └─ shell · export ledger window …                         0.3s
scoring.evaluate       1.4s
telemetry.collect      0.3s

teardown (not counted in total):
agent.teardown         0.2s
sandbox.teardown       0.1s
  └─ persistCache          0.1s
     └─ shell · tar czf …                      0.1s
sandbox.stop           0.5s
```

缩进表达包含关系而不是可相加的账本：hook 包含命令，turn 包含启动 Agent CLI 的命令，OTel span 又可能嵌套或并发；子项不能求和后与父项比较。runner 节点使用本机单调时钟，OTel 节点使用 span 自带时钟，跨进程只按 `traceId` / parent span 关系归属，不按绝对时间硬对齐。主链各阶段之和小于等于 `total`，差值是阶段间的粘合代码，不单独列行。

### operation 提供语义，renderer 只负责通用投影

一个由 runner、Sandbox 或 provider 自己拥有的逻辑工作，如果内部会批量处理很多对象或执行多个低层步骤，采集端应记录一个 `kind: "operation"` 的父节点。`label` 在采集时就写成有界的人读摘要，例如 `export workspace diff · 1 window · 3,302 files`；实际经过公开 Sandbox 边界的命令仍作为它的 `command` child 留下。批量工作应在 Sandbox 内一次完成一个逻辑批次，不能先制造逐文件远端调用，再指望 renderer 把性能问题藏起来。

artifact 不保存 render callback，renderer 也不解析 `git show ...`、`cat-file ...` 或其它 shell 文本来猜 command family。这样既不把 git/ledger 细节塞进通用 Reports，也不会把路径不同的真实调用误合并成一个虚构步骤。语义压缩来自 producer 写下的 operation；renderer 面对任意未知节点只使用统一的预算、失败、耗时和时序规则。

`show` 在 TTY、管道、CI 与 coding agent 环境使用同一选择规则，不因是否交互而改变节点集合，也不自动启动 pager。需要翻页时由用户显式运行 `niceeval show @loc --timing=full | less -R`；CLI 不能像 `git log` 那样在 TTY 下擅自进入一个会等待输入的进程。

### 大时间树的输出 case

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

## `--diff`：核对 agent 实际改动

显示的是 [agent 归因增量](../sandbox/architecture.md#变更归因send-窗口与分类账)：只有 agent 在 send 窗口内改动的文件，起始 fixture 与验证材料不混在里面。裸 `--diff` 是文件级摘要——状态、增删行数、哪几轮改的：

```text
$ niceeval show @1qrdcfq8 --diff
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · failed

2 files changed by agent
  M manager_decisions.json   +6 -2    s1/t1, s1/t2
  A notes/decision-log.md    +18      s1/t2

single file: niceeval show @1qrdcfq8 --diff=manager_decisions.json
```

`--diff=<path>` 输出单文件 patch，**按窗口逐段渲染**（`diff.json` 存的就是逐窗口 delta，窗口之间可能夹着 eval 侧写入，不产出跨窗口合成 patch）：

```text
$ niceeval show @1qrdcfq8 --diff=manager_decisions.json
M manager_decisions.json · touched in s1/t1, s1/t2

── window s1/t1
@@ -1,5 +1,6 @@
 {
-  "15193": { "selected_proposal_id": 1 },
+  "15193": { "selected_proposal_id": 4 },

── window s1/t2
@@ -2,6 +2,7 @@
+  "15201": { "selected_proposal_id": 2 },
```

`--diff=<path>` 必须用 `=` 连写，空格后的 token 会按 eval id 位置参数解析。二进制文件在摘要里显示字节数变化，不输出 patch。`diff.json` 缺失（remote agent、或发布时未带 `diff`）时如实输出 `diff unavailable` 并说明原因，不猜。

## 选择结果范围

```sh
niceeval show --run tmp/published-results
niceeval show --experiment dev-e2b           # 整个可比组
niceeval show --experiment dev-e2b/codex-e2b
niceeval show memory/swelancer --experiment dev-e2b/codex-e2b
niceeval show --report reports/exam.tsx
niceeval show --report reports/site.tsx --page exam
```

`--run` 改变结果根，`--experiment` 和位置参数在其中收窄 Selection；`--experiment` 按路径段匹配 id 前缀，因此 `--experiment dev-e2b` 选中整个可比组但不会误中 `dev-e2b-next`。收窄完成后默认报告才按组分区，位置参数仍只表示 eval id 前缀。`--report` 用自定义报告替换榜单，但 attempt locator 的下钻命令保持不变。`--history` 是内置时间轴，与 `--report` 互斥。

`--report` 文件的默认导出是一棵报告树（`defineReport`）或一份站点（[`defineSite`](library.md#站点多页与导航外壳)）。站点只有一页、或 `--page <id>` 命中一页时，直接渲染该页报告的 text 面；多页且未传 `--page` 时只输出页索引与可复制的单页命令——与可比组索引同一模式，不把全部页倾倒进终端：

```text
$ niceeval show --report reports/site.tsx
记忆能力评测 · 2 页

  overview   总览      niceeval show --report reports/site.tsx --page overview
  exam       成绩单    niceeval show --report reports/site.tsx --page exam
```

`--page` 未命中任何页 id、或对非站点的报告文件使用时，按用法错误非零退出并列出可用页 id。站点的导航外壳（`links`、`footer`、`scripts`、`styles`）是 web 面属性，text 面只消费页定义与站点标题。

## 无匹配与不可读结果

漏写 locator 的 `@` 时，输入按 eval id 前缀处理并明确报无匹配，不做模糊猜测：

```text
$ niceeval show 1qrdcfq8
No results matched: 1qrdcfq8. Evals with results: memory/agent-037-updatetag-cache, memory/swelancer-manager-proposals
```

扫描结果根时，可读快照照常参与报告；未完成、损坏或 schema 不兼容的快照会列出原因。完全没有可读结果时命令非零退出，并对带 `producer.version` 的旧格式给出对应版本的 `npx niceeval@<version> show --run <root>` 建议。

## 相关阅读

- [Reports Library](library.md) —— `--report` 文件怎样写。
- [Results](../results/README.md) —— show 读取的文件和 artifact。
- [Agent 反馈闭环](../../../docs-site/zh/guides/agent-feedback-loop.mdx) —— 在 AI 自迭代中组合这些命令。
