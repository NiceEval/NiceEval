# `--execution`：看执行中做了什么

`--execution` 是 attempt-detail 组件族对应区块的 text 面：对话按轮分段、轮内按时间线卡片显示，而不是把长内容塞进表格。表格适合短、同构字段；prompt、命令和 stdout 都可能多行且很长，卡片能保留阅读顺序，也便于复制命令和结果。每轮以 turn 头行开始，头行首列就是[轮标签](../../scoring/library/display.md#turntsend的展示)（与 [`--timing`](timing.md) 的 turn 节点、diff 的 `windows` 同一枚 token），随后是 Turn status、该轮墙钟与 usage；逐卡片语法与 waiting / failed / DATA 卡片的示例见 [Scoring · 断言与 Turn 的展示](../../scoring/library/display.md#turntsend的展示)：

```text
turn1 · completed · 22.4s · 12.4k tok · $0.02
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

`--execution` 以「做了什么」为主，时间只是事件旁的上下文注释；它不负责阶段聚合，也不把未关联 span 猜到某条事件上。除了 Agent 事件，它还在对应 attempt 节末尾列出 NiceEval 直接观察到的失败 Sandbox 命令（`commands.json`）：标题带 lifecycle phase、exit code 与 timing node 耗时，正文分 stdout / stderr。这样 setup 或 Eval 手工命令失败时，不必指望 Agent event：

```text
  FAILED COMMAND · eval.run · exit 243 · 1.2s
    npm install -g pnpm@10.34.5
    stderr
      npm error code EACCES
      npm error path /usr/lib/node_modules/pnpm
      npm error errno -13
      (+18 lines · 1480 chars · niceeval show @1jmvhiau --execution --expand cmd1)
```

失败命令按 timing `startOffsetMs` 排列；`timingNodeId` 唯一关联失败命令卡与
[`--timing`](timing.md) 的 command 节点。若 Eval 随后抛出的 `error.message` 只剩截断尾部，
Attempt 首页在错误摘要后明确提示
`failed command evidence: niceeval show @<locator> --execution`。要从整个 attempt 回答「时间花在哪里」，使用 [`--timing`](timing.md)。

## 卡片预览预算与 `--expand`

卡片预览预算与展开句柄是这个区块 text 渲染面的选项，不是事实过滤器；JSON 面恒为完整 resolve 产物（[切片是组件选择](../architecture.md#show-的切片是组件选择)）。卡片正文是**有界预览**，主尺度是行：每个内容段最多显示前 3 行（保留原始换行）。段按卡片结构划分——角色文本、thinking 这类单段卡的正文即一段；TOOL 卡的 input 与 result 各为一段（`input` / `result · <status>` 骨架行不计入）；失败命令卡的命令行、stdout、stderr 各为一段。每段另有 1 KiB（UTF-8 字节，按字符边界回退）兜底，防单行超长的 JSON blob 击穿行预算。选 3 行而不是更宽，是因为这个视图的职责是全景骨架——回答「这一步做了什么、结果开头长什么样」，让整个 attempt 的树落在一两屏内；细读任何一张卡都是一条显式的 `--expand` 命令，不靠预览硬扛。

任一段被折叠时，卡尾追加一条截断尾巴。尾巴不是死胡同——它自带出路，报整卡被折的行数与字符数，以及这张卡片的**展开句柄**，沿用 `next:` 提示的习语：

```text
  TOOL · memory_search  +4.1s
    input
      { "query": "react-datepicker month navigation" }
    result · completed
      total=5 · [0.845] react-datepicker-month-navigation: The month-change
      notification also fires while syncing preselection, so the panel index
      resets to the preselected month even after the user has navigated away.
      (+41 lines · 3877 chars · niceeval show @1jmvhiau --execution --expand t2.c3)
```

- Agent 事件卡句柄语法是 `t<turn 序号>.c<轮内卡片序号>`，两个序号都从 1 起，由 `events.json` 的事件序确定性派生。失败 Sandbox 命令卡使用 `cmd<序号>`，按 `commands.json` 中 `timingNodeId` 对应节点的 `startOffsetMs` 稳定排序后从 1 编号。同一份 artifact 上句柄永远指同一张卡片，可以写进脚本与笔记。
- `--expand <handle>` 与 `--execution` 组合、要求恰好一个 attempt 的范围，输出该卡片的完整落盘内容（原始换行，不再截断）。落盘时已被 [256 KiB 上限](../../results/architecture.md#大值截断)截断的值如实带 `truncated` 标注与原始字节数——展开还原的是落盘证据，不是运行时全量。
- 句柄未命中（turn 或卡片序号超界）按用法错误退出，并报该 attempt 实际的 turn 数与该 turn 的卡片数，不猜相邻卡片。
- JSON 面恒为完整 resolve 产物，不受预览预算约束；`--expand` 与 `--json` 组合因此是用法错误的推论，不是特判（[形状](json.md)）。

## 范围化：跨 attempt 扫描与 `--grep`

`--execution` 接受任意[范围](../show.md#一次调用-范围-切片-形态)：范围含多个 attempt 时，宿主机器按 experimentId、evalId、attempt 序把这个区块逐 attempt 映射并分节，节头一行 `@<locator> · <evalId> · <experimentId> · <verdict>` 是宿主机器写的定位行，节内内容仍由组件的 text 面产出，格式与单 attempt 相同。全量输出很长是允许的（与 `--timing=full` 同一态度）；跨 attempt 的常规问法用 `--grep` 收窄这个 text 渲染面的注意力范围。

`--grep <pattern>` 是这个区块 text 渲染面的选项，不是事实过滤器：它只输出命中的卡片，不改变哪些证据存在。pattern 是 JS 正则，匹配面是卡片的全部文本字段——角色文本、工具名、input、result，以及失败 Sandbox 命令的 display / stdout / stderr；每张命中卡片自带定位行，末尾汇总命中数：

```text
$ niceeval show --exp memory/codex-nowledge --execution --grep 'memory_search|nmem m search'
@1jmvhiau · react-datepicker/pr-6058 · memory/codex-nowledge · turn2
  TOOL · memory_search  +4.1s
    input
      { "query": "react-datepicker month navigation" }
    result · completed
      total=0
…
26 matches in 30 attempts (11 attempts with 0 matches)
```

- 「search 到底做了没有、查了什么词、命中几条」这类横跨整个 run 的问题，一次 `--grep` 终结，不需要逐 attempt 通读。
- 0 命中时明确输出 `0 matches in N attempts`，并非零退出——沉默的空输出无法与「忘了跑」区分。
- `--grep` 只与 `--execution` 组合，出现在其它切片上按用法错误退出。
- 命中卡片同样受预览预算约束，截断尾巴照常带 `--expand` 句柄（句柄里的 locator 让命令天然可复制）。

## 相关阅读

- [`--timing`](timing.md) —— 时间分析入口。
- [`--source`](eval-source.md) —— 从轮次回到源码行。
- [`--json`](json.md) —— 执行树的结构化形状。
