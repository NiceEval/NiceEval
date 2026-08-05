# 运行中观察（Live Run Observation）

**审查状态（ChatGPT Pro，2026-08-05）：方向正确，可定稿；v1 须收紧事件模型。**  
`watch` 是运行时观察面，不是 execution log；`exp --json` 是状态事件流，不是第二份结果；`session` 是索引；`show` 仍拥有终态证据唯一权威。

跑批与盯进度时，人与 coding agent 需要**在 attempt 尚未终态时**知道「哪一题、卡在哪一层、是不是基础设施」。
今天这条路径只对**附着在 TTY 上的人**勉强可用；把 `niceeval exp` 丢到后台、管道或 agent 会话里时，观察面塌缩成计数心跳，逼观察者 docker exec、扫日志或读 `.niceeval/` 落盘——后两者要么越权，要么破坏 dogfood「只走 CLI」的纪律。

本主题补齐**运行中**的可观察契约，不重做 `show` 终态证据面，也不改调度与 Sandbox 生命周期。

## 解决的问题

来自 MemoryBench 类真实长跑（串行 15+ 题补跑、双实验并行、sandboxReuse）的观察失败：

| 现象 | 今天的缺口 |
|---|---|
| 后台 / 非 TTY 跑 `exp` | live 面板的 ANSI 重绘进日志后只剩 `elapsed · N passed · …`；**看不到当前 evalId、phase、progress 文案** |
| `exp --json` | 有 `start` / 30s `progress` 心跳 / 终态 `failure`·`error`·`eval`·`result`；**明确不输出**「当前 attempt 阶段与最近进度」（见 [Experiments CLI](../../feature/experiments/cli.md) 对照表） |
| 判断卡在 clone / install / agent / 隐藏测 | 只能 `docker exec` 看 `package.json`、`ps`、`git status`；agent 写 fragile 的进程嗅探，易误报 |
| 双实验并行（remem + obelisk） | `session list` 给到 session 级 running/queued，**没有**跨 session 的统一盯盘，也没有「当前题」 |
| errored vs failed | 终态 `show` 够用；**运行中** FAILURES 截断，agent 要等题结束再 `show @loc` |
| sandboxReuse 污染 | 收尾才有 contamination 警告；运行中看不到将至风险 |
| plan 上 `concurrency 8` | 全局闸与 experiment `maxConcurrency: 1` 并存时，观察者误读为 8 路 clone |
| dogfood 纪律 | 禁止读 `.niceeval/**`；**live 观察却没有对等的 CLI 切片** |

要解决的不是「多打印几行 log」，而是：**给非附着观察者一条与 live 面板同事实源、可机器消费的运行中读面**。

## 核心心智

三个角色、三份读面，不混：

| 角色 | 读面 | 问题 |
|---|---|---|
| 附着操作者 | 现有 TTY live 面板（可增强，不替换） | 我眼前这一批在干什么 |
| **旁路观察者**（另一终端、agent、IDE） | **本主题：`niceeval watch` + 增强的 `exp --json` 事件** | 不占用进程 stdin、不抢 TTY，仍能跟 phase / 当前题 |
| 终态审计者 | `show` / `view`（已定稿） | 这题为什么挂、证据是什么 |

概念：

- **Session**（已有）：一次 `exp` 调度登记；`session list/show` 继续做索引，**不**膨胀成第二套 execution 流。
- **Live snapshot**：某一时刻各 Experiment 的计数 + 每个 active attempt 的 `evalId`、`locator?`、`phase`、短 `detail`、elapsed。
- **Live event**：attempt 边界与**阶段**边界上的有界事件；不是工具 stdout 全文，也不是第二套 execution log。
- **观察附着（attach）**：对已在跑的 Session 打开只读事件流 / 快照轮询，不启动新调度。

事实源仍是 runner 内部状态机与 Attempt 生命周期；watch 与 `exp --json` **投影**同一状态，不另建影子进度文件。

## 拟定稿契约（v1）

### 1. 增强 `exp --json`：有界 attempt 事件（v1 必做）

在现有 NDJSON 上增加有界事件。**v1 必做集合故意收紧**：

| 事件 | v1 | 何时 | 必有字段（示意） |
|---|---|---|---|
| `attempt_start` | ✅ | attempt 租到 slot | `sessionId`, `experimentId`, `evalId`, `attempt`, `sandbox?` |
| `attempt_phase` | ✅ | `LifecyclePhase` 切换 | 同上 + `phase`（与 record 同源闭集）+ 可选短 `detail` |
| `attempt_end` | ✅ | 终态已知 | 同上 + `status` + `locator` + 短 `summary` + `durationMs` |
| `snapshot` | ✅ | 附着时 / `--once` | 计数 + active attempts 列表 |
| `attempt_progress` | ⚠️ 可选 / 可后置 | 作者 `t.progress` 更新 | 硬截断 message；避免 phase 风暴级频率 |
| `progress` 心跳 | ✅ 保留 | 可降频 | 现有计数 |
| `failure.kind` 投影 | ❌ 非 v1 | — | 见「已裁决」：后置，不进 v1 schema |

规则：

- **机器面默认打开** attempt 边界与 phase 事件（agent 友好优先）；若 CI 体积成为实测问题，再加安静开关，而不是默认安静。
- 每个事件有硬上限（message/detail 字符数）；全文 stdout 仍不进运行流。
- `attempt_phase` 的 `phase` 与落盘 `error.phase` / `show --timing` **同一闭集**；禁止第二套「clone/install」词表进 schema；作者 progress 文案只进 `message`/`detail`。
- 不把 docker 内 `ps` 推断写进契约。

### 2. 新命令：`niceeval watch`

旁路观察者的默认入口：

```bash
niceeval watch
niceeval watch s_01ac42f0
niceeval watch --exp compare/codex-gpt-5.6-luna--remem
niceeval watch --json
niceeval watch --json --once
```

| 形态 | 行为 |
|---|---|
| 人读 TTY | 只读 live 面板：ACTIVE（当前题 + phase + detail + elapsed）、计数、最近 FAILURES；**不**重跑实验 |
| 人读非 TTY | 追加流：snapshot 摘要 + 后续 phase/end 行 |
| `--json` | 先 `snapshot`，再 NDJSON tail；Session 结束后退出（默认跟随到结束） |

附着语义：

- 只读 Session 登记 + runner 暴露的 live 状态通道（IPC 形态实现自选，契约只要求可附着）。
- Session 已结束：打印结束摘要并指向 `show --exp … --history`，退出 0。
- 多个 active Session：**无 selector 时列出候选并非零退出**（避免静默跟错批）；`--all` 分节为可选增强，非 v1 必做。

### 3. `session show` 补「当前题」

活动 Session 的 `session show`（及 `--json`）增加：

- 每个 running experiment：`runningEvalIds[]`（或单并发时的单个 `runningEvalId`）
- 当前 `phase` + `detail`（与 live 同源）
- `passed` / `failed` / `errored` / `queued` 计数

`session list` 仍只做索引；不把 list 扩成监控总线。

### 4. 人读 live 面板小增强（附着者）

- ACTIVE 行**固定显示 `evalId`**；后台日志降级时用纯文本等价行。
- 非 TTY 在 phase 切换时**立即**打一行，而不是只靠 30s 心跳。
- plan 行同时给出 `globalConcurrency` 与 `experimentMaxConcurrency`（或「本批生效并发」）。

### 5. failure `kind`（明确后置）

运行中 `infra.network` / `domain.*` 等 kind 投影有用，但**不进入 v1 事件 schema**。  
v1 用 `status` + 短 `summary`/`message` 即可；kind 作为后续 UX 投影，不进指纹、不进 verdict。

## 范围

**包含（v1）**

- 运行中 snapshot / 收紧的 attempt 事件契约
- `watch` 命令与 `session show` 当前题字段
- `exp --json` 事件扩展（start/phase/end/snapshot）
- 人读非 TTY 阶段行与并发消歧

**不包含（v1）**

- failure `kind` 进入 schema
- 把 `watch` 做成 execution log / 工具 stdout 总线
- 改 Sandbox 复用 / 题间 reset
- 把 `docker exec` / 宿主机进程树升格为公共 API
- 新的结果状态（passed/failed/errored 集合不变）
- 远程 Web 仪表盘

## 与既有面的关系

| 既有 | 关系 |
|---|---|
| [Experiments CLI](../../feature/experiments/cli.md) | live 面板与 `--json` 扩展机器面 attempt 事件 |
| [Session 登记](../../feature/experiments/cli.md) | `watch` 附着 Session；list 仍做索引 |
| [Sandbox 复用反馈](../reuse-feedback/README.md) | reuse 汇总量可并进 snapshot；本主题不重复设计四量口径 |
| [show](../../feature/reports/show.md) | 终态深读不变；watch 结束指引 `show` |
| [prepare-transient-retry](../prepare-transient-retry/README.md) | prepare 自愈在 activity/phase 上可见；不共享新 kind 词表 |
| dogfood「禁止读 `.niceeval/`」 | watch/json 成为合规观察通道 |

## 已裁决

1. **机器面默认密度**：v1 **默认发** `attempt_start` / `attempt_phase` / `attempt_end`（及附着 snapshot）；不以默认安静保护 CI 体积为先。
2. **`watch` 独立子命令**：`niceeval watch`（比 `session watch` / `exp --attach` 更清晰地服务旁路角色）。
3. **failure `kind`**：**不进 v1 schema**；人读可用启发式，后置产品化。
4. **多 Session 无 selector**：列出候选 + 非零退出，避免跟错批。
5. **phase 词表**：强制复用 LifecyclePhase，禁止平行词表。

## 实现前仍开放的细节

1. 附着通道实现（ring buffer / unix socket / 轮询）；旧 runner 无通道时须返回明确错误。
2. `--timeout` 默认值与跟随结束语义的细调。
3. `attempt_progress` 是否在 v1.1 默认打开，及去重规则。
4. snapshot 是独立 format 文档还是 NDJSON `type: snapshot`（等价即可）。

## 用例草图

### Agent 盯补跑

```bash
pnpm exec niceeval exp compare/codex-gpt-5.6-luna--remem --json > /tmp/remem.ndjson &
pnpm exec niceeval watch --exp compare/codex-gpt-5.6-luna--remem --json
```

agent 解析 `attempt_phase` / `attempt_end`：长时间停在同一 phase → 报告可疑卡死。

### 人附着已启动的批

```bash
niceeval session list
niceeval watch s_01ac42f0
```

### 一次快照

```bash
niceeval watch --exp compare/codex --json --once
```

## 入口

- 本文件：问题、心智、v1 契约、已裁决  
- 定稿后迁入 `docs/feature/` 时再拆 `cli.md` 与 experiments CLI 补丁  

## 成功标准（设计层）

1. 不附着 TTY、不读 `.niceeval/**` 的 agent，能回答：当前 evalId、LifecyclePhase、本批 p/f/e 计数。  
2. 双实验并行时，用 selector 或 list 不会跟错 Session。  
3. 不引入第二套 phase 词表，不把 docker 嗅探写进公共契约。  
4. v1 事件集可被人类在一页纸内讲清，而不是第二套 execution log。
