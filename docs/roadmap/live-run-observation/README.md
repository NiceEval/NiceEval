# 运行中观察（Live Run Observation）

跑批与盯进度时，人与 coding agent 需要**在 attempt 尚未终态时**知道「哪一题、卡在哪一层、是不是基础设施」。
今天这条路径只对**附着在 TTY 上的人**勉强可用；把 `niceeval exp` 丢到后台、管道或 agent 会话里时，观察面塌缩成计数心跳，逼观察者 docker exec、扫日志或读 `.niceeval/` 落盘——后两者要么越权，要么破坏 dogfood「只走 CLI」的纪律。

本主题补齐**运行中**的可观察契约，不重做 `show` 终态证据面，也不改调度与 Sandbox 生命周期。

## 解决的问题

来自 MemoryBench 类真实长跑（串行 15+ 题补跑、双实验并行、sandboxReuse）的观察失败：

| 现象 | 今天的缺口 |
|---|---|
| 后台 / 非 TTY 跑 `exp` | live 面板的 ANSI 重绘进日志后只剩 `elapsed · N passed · …`；**看不到当前 evalId、phase、progress 文案** |
| `exp --json` | 有 `start` / 30s `progress` 心跳 / 终态 `failure`·`error`·`eval`·`result`；**明确不输出**「当前 attempt 阶段与最近进度」（见 [Experiments CLI](../../feature/experiments/cli.md) 对照表） |
| 判断卡在 clone / install / agent / 隐藏测 | 只能 `docker exec` 看 `package.json`、`ps`、`git status`；agent 写 fragile 的进程嗅探，易误报（路径里出现 `yarn`/`pnpm` 字样） |
| 双实验并行（remem + obelisk） | `session list` 给到 session 级 running/queued，**没有**跨 session 的统一盯盘，也没有「当前题」 |
| errored vs failed | 终态 `show` 够用；**运行中** FAILURES 截断，看不出 GnuTLS / EEXIST / gate-fail 分类，agent 要等题结束再 `show @loc` |
| sandboxReuse 污染 | 收尾才有 contamination 警告；运行中看不到 untracked 残留、全局 yarn EEXIST 将至 |
| plan 上 `concurrency 8` | 全局闸与 experiment `maxConcurrency: 1` 并存时，观察者误读为 8 路 clone |
| 包管理器 cache | 无法从 CLI 看到「本 lane 已有 npm cacache / yarn cache / pnpm store」，只能猜下一题会不会冷下 |
| dogfood 纪律 | 禁止读 `.niceeval/**`；**live 观察却没有对等的 CLI 切片**，agent 夹在「不能读盘」与「TTY 里没有机器流」之间 |

要解决的不是「多打印几行 log」，而是：**给非附着观察者一条与 live 面板同事实源、可机器消费的运行中读面**。

## 核心心智

三个角色、三份读面，不混：

| 角色 | 读面 | 问题 |
|---|---|---|
| 附着操作者 | 现有 TTY live 面板（可增强，不替换） | 我眼前这一批在干什么 |
| **旁路观察者**（另一终端、agent、IDE） | **本主题：`niceeval watch` + 增强的 `exp --json` 事件** | 不占用进程 stdin、不抢 TTY，仍能跟 phase / 当前题 |
| 终态审计者 | `show` / `view`（已定稿） | 这题为什么挂、证据是什么 |

概念：

- **Session**（已有）：一次 `exp` 调度登记；`session list/show` 继续做索引，不膨胀成第二套 execution 流。
- **Live snapshot**：某一时刻各 Experiment 的计数 + 每个 active attempt 的 `evalId`、`locator?`、`phase`、短 `detail`、elapsed。
- **Live event**：attempt 边界与阶段边界上的有界事件（进入 phase、progress 文案、failure/error 摘要）；不是工具 stdout 全文。
- **观察附着（attach）**：对已在跑的 Session 打开只读事件流 / 快照轮询，不启动新调度。

事实源仍是 runner 内部状态机与 Attempt 生命周期；watch 与 `exp --json` **投影**同一状态，不另建影子进度文件。

## 候选契约

### 1. 增强 `exp --json`：补齐运行中 attempt 事件

在现有 NDJSON（`format` 事件族）上**增加**有界事件，不另起 schema 名称空间。建议事件：

| 事件 | 何时 | 必有字段（示意） |
|---|---|---|
| `attempt_start` | attempt 租到 slot、进入生命周期 | `sessionId`, `experimentId`, `evalId`, `attempt`, `sandbox?`（reused、编号、承接序号） |
| `attempt_phase` | `LifecyclePhase` 切换 | 同上 + `phase`（闭集与 record 同源）+ 可选 `detail` |
| `attempt_progress` | 作者 `t.progress` / adapter 短 detail 更新 | 同上 + `message`（截断）+ 可选 `facts` 增量键名 |
| `attempt_end` | 终态已知 | 同上 + `status` + `locator` + `summary`（errored/failed 短因）+ `durationMs` |
| `progress` | 保留；可降为纯计数心跳，或在有上述事件时减少频率 | 现有计数 |

规则：

- **机器面默认就有**这些事件（或由 `--json=live` 显式打开——待裁决），不再「只给人读 active 行」。
- 每个事件有硬上限（message/detail 字符数、facts 键数）；全文 stdout 仍不进运行流。
- `attempt_phase` 的 `phase` 与落盘 `error.phase` / `show --timing` **同一闭集**，禁止第二套「clone/install」词表进 schema；作者 progress 文案（如 `cloning …`）只进 `message`/`detail`。
- 不把 docker 内 `ps` 推断写进契约；runner 只报告自己调度到的 phase 与已发布的 progress。

### 2. 新命令：`niceeval watch`

旁路观察者的默认入口：

```bash
# 附着当前记录根下最新 active Session
niceeval watch

# 按 session / experiment 前缀
niceeval watch s_01ac42f0
niceeval watch --exp compare/codex-gpt-5.6-luna--remem

# 机器面：与 exp --json 同形事件流（可从中途附着，先发 snapshot 再跟 tail）
niceeval watch --json
niceeval watch --json --once   # 只打一份 snapshot 文档后退出
```

行为：

| 形态 | 行为 |
|---|---|
| 人读 TTY | 只读 live 面板：ACTIVE（当前题 + phase + detail + elapsed）、计数、最近 FAILURES；**不**重跑实验 |
| 人读非 TTY | 追加流：snapshot 一行摘要 + 后续 phase/end 事件行 |
| `--json` | 先一条 `snapshot` 文档或事件，再 NDJSON tail；进程退出或 Session 结束后发 `result` 或 `session_end` 并退出（默认跟随到结束；`--timeout` 待裁决） |

附着语义：

- 只读 Session 登记 + runner 暴露的 live 状态通道（实现可以是 unix socket / 状态文件 + 通知，**契约只要求可附着**，不规定 IPC 形态）。
- Session 已结束后：`watch` 打印结束摘要并指向 `show --exp … --history`，退出码 0；不假装还在跑。
- 多个 active Session：无 selector 时列出候选并非零退出（或 `--all` 分屏/分节——待裁决），避免静默跟错批。

### 3. `session show` 补「当前题」

在不引入第二套 execution 的前提下，活动 Session 的 `session show`（及 `--json`）增加：

- 每个 running experiment：`runningEvalIds[]`（或单并发时的单个 `runningEvalId`）
- 当前 `phase` + `detail`（与 live 同源）
- `passed` / `failed` / `errored` / `queued` 计数

今天 `session list` 只有 running/queued 数量；agent 无法回答「现在卡在哪一题」。

### 4. 运行中失败摘要分级（可选增强）

`failure` / `error` 事件与 FAILURES 行在现有 `code` + `message` 外，增加**可选** `kind` 投影（不进指纹、不进 verdict）：

| kind | 启发式（实现可演进） |
|---|---|
| `infra.network` | message 匹配 GnuTLS / ETIMEDOUT / ECONNRESET / registry fetch aborted 等 |
| `infra.sandbox` | prepare/create/reset 失败 |
| `infra.contamination` | EEXIST 全局路径、reuse diagnostic |
| `domain.assertion` | failed + matcher / commandSucceeded |
| `domain.agent` | agent-send-failed / turn 失败 |
| `unknown` | 其余 |

观察者可对 `infra.*` 自动建议「可补跑」；`domain.*` 默认 carried。  
kind 是 UX 投影，不是新的结果状态。

### 5. 人读 live 面板小增强（附着者）

不改变列模型主导权的前提下：

- ACTIVE 行**固定显示 `evalId`**（今日本有则保持；后台日志降级时应用纯文本等价行，避免只剩计数）。
- 非 TTY 追加流在 phase 切换时**立即**打一行 `evalId phase detail`，而不是只靠 30s 心跳。
- plan 行同时给出 `globalConcurrency` 与 `experimentMaxConcurrency`（或「本批生效并发」），消歧「concurrency 8」。

## 范围

**包含**

- 运行中 snapshot / 事件契约
- `watch` 命令与 `session show` 当前题字段
- `exp --json` 事件扩展
- 可选 failure `kind` 投影
- 人读非 TTY 阶段行

**不包含**

- 改 Sandbox 复用 / 题间 reset / 记忆条件拓扑
- 把 `docker exec` / 宿主机进程树升格为公共 API
- 在运行流中倾倒完整 shell stdout 或 `events.json` 全文（仍归终态 `show --execution`）
- 新的结果状态（passed/failed/errored 集合不变）
- 远程 Web 仪表盘（可用同一 JSON 事件，但是后续产品）

## 与既有面的关系

| 既有 | 关系 |
|---|---|
| [Experiments CLI](../../feature/experiments/cli.md) | live 面板与 `--json` 的人机分工在此扩展机器面 attempt 事件 |
| [Session 登记](../../feature/experiments/cli.md) | `watch` 附着 Session；list 仍做索引 |
| [Sandbox 复用反馈](../reuse-feedback/README.md) | reuse 汇总量可并进 snapshot；本主题不重复设计四量口径 |
| [show](../../feature/reports/show.md) | 终态深读不变；watch 结束指引 `show` |
| dogfood「禁止读 `.niceeval/`」 | watch/json 成为合规观察通道，消除「只能读盘」的压力 |

## 待裁决分歧

1. **机器面默认密度**：所有 `exp --json` 默认发 `attempt_*`，还是默认保持安静、要 `--json=live` / `--live-events` 才打开？（agent 友好 vs CI 日志体积）
2. **`watch` 是否独立子命令**：`niceeval watch` vs `niceeval session watch` vs `niceeval exp --attach`。
3. **附着通道实现**：Session 目录内 ring buffer / unix socket / 仅轮询 registry；契约是否允许「无附着通道的旧 runner 返回明确错误」。
4. **多 Session `--all`**：分节人读 vs 强制 selector。
5. **failure `kind`**：是否进入 1.0 事件 schema，还是仅人读启发式。
6. **非 TTY 阶段行**与 30s 心跳的去重规则，避免 phase 风暴。
7. **snapshot 事件**是单独 `format: niceeval.live-snapshot` 文档，还是 NDJSON 里的 `type: snapshot`。

## 用例草图

### Agent 盯补跑

```bash
pnpm exec niceeval exp compare/codex-gpt-5.6-luna--remem --json > /tmp/remem.ndjson &
# 另一侧
pnpm exec niceeval watch --exp compare/codex-gpt-5.6-luna--remem --json
```

agent 解析 `attempt_phase` / `attempt_end`：  
- `errored` + `kind=infra.network` → 记「可再补跑」  
- `failed` → 记 locator，不建议自动 `--rerun=failed`  
- 长时间停在同一 `phase` + 不变 `detail` → 报告可疑卡死（阈值待产品化）

### 人附着别人已启动的 TTY 批

```bash
niceeval session list
niceeval watch s_01ac42f0
```

不抢原 TTY，不重跑。

### 一次快照（脚本 / CI step）

```bash
niceeval watch --exp compare/codex --json --once
```

## 入口

- 本文件：问题、心智、候选契约、分歧  
- 定稿后迁入 `docs/feature/` 时再拆 `cli.md`（命令表面）与 experiments CLI 补丁；实现前不强制拆文件  

## 成功标准（设计层）

1. 不附着 TTY、不读 `.niceeval/**` 的 agent，能回答：当前 evalId、LifecyclePhase、最近 progress、本批 p/f/e 计数。  
2. 双实验并行时，用 selector 或 list 不会跟错 Session。  
3. 基础设施 errored 与领域 failed 在运行中即可粗分，不必等全批结束。  
4. 不引入第二套 phase 词表，不把 docker 嗅探写进公共契约。  
```
