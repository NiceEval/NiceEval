# `niceeval show` —— 在终端读结果

`niceeval show` 不运行 eval，只读取结果根。它适合在 shell 或 coding agent 循环里快速回答三个问题：哪一题失败、失败的实际值是什么、下一步该看哪份证据。

## 从榜单下钻到 attempt

```sh
niceeval show                              # 当前结果的默认 ExperimentComparison
niceeval show memory/swelancer             # 按 eval id 前缀收窄
niceeval show @1qrdcfq8                    # 打开一个 attempt 的诊断首页
niceeval show @1qrdcfq8 --eval             # 断言标回 eval 源码
niceeval show @1qrdcfq8 --execution        # 对话、工具调用和步骤耗时
niceeval show @1qrdcfq8 --diff             # workspace 改动摘要
niceeval show @1qrdcfq8 --diff=path/to.ts  # 某个文件的完整 diff
niceeval show memory/swelancer --history   # 这个 eval 的真实执行历史
```

榜单中的 `@<locator>` 是 attempt 的稳定引用。它必须带 `@`，既不是数组下标也不是文件路径。把 locator 复制给后续命令，便可从汇总数字回到同一次执行的证据。

## 裸 `show`：默认报告的 text 面

裸 `niceeval show` 与显式渲染内置 `ExperimentComparison` 等价。报告先输出成本 × 成功率散点图，再输出 `ExperimentList`。只有一个可画 experiment 时也照常显示一个点，不要求至少两个实验。

`ExperimentList` 的 text 面保持实体层级：一个 experiment 下列 Eval，一个 Eval 下再列它的全部 Attempt。不能把 Eval 与 Attempt 压平成一张“每行一个 Attempt、重复 Eval id”的表。

```sh
$ niceeval show
WARNING  snapshot dev-e2b/codex-e2b @ 2026-07-12T10:08:29.361Z is unfinished;
         8 completed attempts are shown, but the snapshot may be incomplete.

平均每个 eval 成本（越低越好） × 成功率
... A

越靠右上越好
A dev-e2b/codex-e2b

实验                    模型            Agent   平均耗时   成功率   结果               Tokens    预估成本
dev-e2b/codex-e2b      gpt-5.4-mini    codex   1m 58s    66.7%   4 通过 / 2 失败    198.9k    $0.17
6 道题 · 6 次 attempt · 2026-07-12T10:08:29.361Z

dev-e2b/codex-e2b
状态      题目 / Attempt                          结果                                      耗时      成本
✓ 通过    memory/agent-037-updatetag-cache
  ✓       └─ @160iuj3h                            —                                         2m 0s     $0.09
✓ 通过    memory/repomod-hello-world-api
  ✓       └─ @1sxmo0m1                            —                                         2m 58s    $0.57
✗ 失败    memory/swelancer-manager-proposals
  ✗       └─ @1qrdcfq8                            expected 4, received 1 · equals(4)          50.0s     $0.05
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

locator 只打印 `@<id>` 与 verdict，不追加证据能力缩写。locator 本身就是证据入口；打开 Attempt 后再列实际可执行的证据命令。

## 失败诊断首页

无 flag 打开 attempt 时，输出先给判定，再逐条列失败断言的分组、matcher、期望值、实际值和源码位置：

```text
$ niceeval show @1qrdcfq8
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · failed
snapshot 2026-07-12T10:08:29.361Z · attempt 1 · 50.0s · 58.5k tokens · $0.05

assertions: 3 passed · 1 gate failed
eval source: evals/memory/swelancer-manager-proposals.eval.ts · sha256:ee33b9c4…

failures:
  gate · Issue 15193: selected proposal matches the one maintainers accepted
    assertion: equals(4)
    expected: 4
    received: 1
    source: evals/memory/swelancer-manager-proposals.eval.ts:40:11

execution: 12 events · 0 skill loads · 7 tool calls · 4 AI messages
timing: OTel spans recorded for this attempt — see --execution for per-step timing.

changes: 1 file changed · M manager_decisions.json

artifacts: .niceeval/dev-e2b_codex-e2b/<snapshot>/memory/swelancer-manager-proposals/a0/
available:
  niceeval show @1qrdcfq8 --eval
  niceeval show @1qrdcfq8 --execution
  niceeval show @1qrdcfq8 --diff
```

这页应当足以判断“为什么失败”。只有实际可用的命令才出现在 `available`；没有捕获某类证据时省略对应命令。只有在需要理解断言上下文、agent 为什么给出这个结果、或具体改了什么时，才继续打开证据切面。

`errored` attempt 的首页不用 trace 也必须能解释基础设施错误。它先显示结构化 error 的 phase/operation、code、message 与有限 cause,再列本 attempt 的 diagnostics;stack 放在后面并保持原始换行:

```text
$ niceeval show @2h8m4k1
@2h8m4k1 · memory/agent-029-use-cache · compare/claude-e2b · errored

error:
  phase: sandbox provision
  code: sandbox-rate-limit
  message: E2B sandbox allocation failed after 5 attempts
  cause: RateLimitError · too many concurrent sandboxes

diagnostics:
  warning · sandbox.provision · fallback-region
    Primary region was unavailable; retried in us-west (2 occurrences)

execution: unavailable (attempt failed before telemetry was configured)
```

diagnostic 的 level 不等于 verdict:一个 passed/failed attempt 也可以带 cleanup warning。榜单只显示致命 error 的一层原因;diagnostics、cause 和 stack 留在 locator 首页,避免几十个并发 sandbox 错误淹没终端。

## `--eval`：把断言放回源码

`--eval` 显示运行时保存的 eval 源码，而不是工作树中可能已经修改过的文件。通过与失败断言标在对应行；失败行紧跟分组、matcher、期望值和实际值。

```text
38      for (const [issue, label] of Object.entries(expected)) {
39        await t.group(`Issue ${issue}: selected proposal matches the one maintainers accepted`, async () => {
40✗         t.check(Number(decisions[issue]?.selected_proposal_id), equals(label.selected_proposal_id));
    gate · Issue 15193: selected proposal matches the one maintainers accepted ·
    equals(4) · expected 4 · received 1
41        });
42      }
```

长行会截断，末尾的 `full eval source` 指向 `sources.json`，需要完整文本时直接读取该 artifact。

## `--execution`：看 agent 做了什么

对话按时间线卡片显示，而不是把长内容塞进表格。表格适合短、同构字段；prompt、命令和 stdout 都可能多行且很长，卡片能保留阅读顺序，也便于复制命令和结果。

```text
USER
  You are the engineering manager for this project. ...

ASSISTANT
  I’m going to inspect the task layout and the decision format first ...

TOOL · command_execution
  input
    /bin/bash -lc 'find . -maxdepth 2 -type d | sort'
  result · completed · exit 0
    .
    ./.git
    ./tasks
```

主时间线只保留用户消息、assistant 消息、skill、subagent 与工具调用。没有关联到这些步骤的框架 telemetry 不混进对话；末尾会报告省略数量，并给出完整 `trace.json` 路径：

```text
total 50.0s · 0 skill loads · 7 tool calls · 4 AI messages
full events: .niceeval/.../events.json
69 unlinked telemetry spans omitted; inspect the OTel trace for framework timing.
full OTel trace: .niceeval/.../trace.json
```

## `--diff`：核对实际改动

```sh
niceeval show @1qrdcfq8 --diff
niceeval show @1qrdcfq8 --diff=manager_decisions.json
```

第一条用于发现改了哪些文件和大致规模；第二条输出单文件 patch。`--diff=<path>` 必须用 `=` 连写，空格后的 token 会按 eval id 位置参数解析。

## 选择结果范围

```sh
niceeval show --run tmp/published-results
niceeval show --experiment dev-e2b/codex-e2b
niceeval show memory/swelancer --experiment dev-e2b/codex-e2b
niceeval show --report reports/exam.tsx
```

`--run` 改变结果根，`--experiment` 和位置参数在其中收窄 Selection。`--report` 用自定义报告替换榜单，但 attempt locator 的下钻命令保持不变。`--history` 是内置时间轴，与 `--report` 互斥。

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
