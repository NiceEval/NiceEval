# Experiments CLI Human 输出设计

本页定义所有 NiceEval CLI 命令和默认 Report 的 Human 输出设计。`exp` 的命令、参数、退出码和机器输出精确契约
仍归 [Experiments CLI](cli.md)；其它命令的精确契约归各自 Feature 的 CLI 文档。

Human 输出服务正在运行和诊断评测的人。它只展示用户能理解、能验证或能继续操作的信息，不直接投影 Runner、Record、Analysis 或 Coordination 的内部数据模型。

## Human 与 machine 分层

同一事实可以有两种投影，但两种投影承担不同职责：

| 输出 | 面向对象 | 保留内容 |
|---|---|---|
| Human | 运行和诊断评测的人 | 任务身份、结果、真实错误、影响范围、可复制的下钻命令 |
| JSON / Record | 自动化、Report 与调试工具 | 稳定 code、phase、内部关联身份、状态机 action 和完整结构化字段 |

机器字段不能因为 Human 隐藏而删除。Human 也不能因为机器字段已经存在，就要求用户理解这些字段。

## Human 输出允许出现什么

默认 Human 输出只出现下列信息：

- 用户声明的 Experiment、Eval、Agent 和 model 名称；
- `passed`、`failed`、`errored`、`skipped`、正在运行和尚未启动等结果；
- Attempt 数量、耗时、token 与成本；
- 经过脱敏和长度限制的真实错误；
- `niceeval show @<locator>` 或 `niceeval show --run <runId>` 等可复制命令。

默认 Human 输出不展示下列内部字段：

- `slotId`、slot、ordinal、Member、relation 和 `not-dispatched`；
- `failureId`、timing node ID、`n1`、BuildKey 和 CaseKey；
- `sandbox.image.build` 等机器 phase key；
- `identity-mismatch`、gap、carried 等 planner 或 Record action；
- `case lock`、concurrency slot、lease 和 `elsewhere` 等协调器状态桶；
- Analysis 内部消息，例如 `the selected logical Slot has no input value`。

这些值可以继续出现在 JSON、Record、开发者诊断或明确选择的高级视图中。

## 用户词汇

Human 采用用户动作和结果词汇，不采用内部实体名：

| 内部事实 | Human 表达 |
|---|---|
| 一个 planned slot | 一个 planned Attempt |
| `6 slots` | `6 attempts not started` |
| attempt ordinal `0` | `Attempt #1` |
| `not-dispatched` | `not started` |
| `reuse/carried` | `using a result from a previous run` |
| `identity-mismatch` | `will run because the configuration changed` |
| `elsewhere` | `waiting for another NiceEval run` |
| recovered case lock | `Recovered stale coordination state; the run continued.` |
| sharedState cleanup retained | `sharedState remains owned; explicit recovery is required.` |

`attempts`、`evals` 和 Experiment/config 名称来自用户的运行计划，可以直接展示。表示计划乘积时优先写清对象，例如 `18 attempts · 6 evals × 3 run configurations`。

其它命令组遵守同一翻译边界：

| 命令或视图 | Human 显示 | 默认不显示 |
|---|---|---|
| `show --run` | Experiment、Eval、`Attempt #N`、结果、真实错误和下钻命令 | Membership、Slot、Relation、空 Analysis note |
| `show @<locator>` | 该 Attempt 的结果、Evidence、执行轨迹和 File Changes | 内部 owner/ref、空领域表 |
| `sandbox list` | Sandbox ID、Provider、能否进入、origin Attempt 和对应命令 | registry 文件名、detached capability 或 Provider SDK 类型 |
| `clean` / `migrate` | 将检查或改变什么、影响数量、确认要求和结果 | lease key、directory marker 或 schema decoder 名称 |
| `view` | URL、构建状态和可执行的失败正文 | revision 内部 identity、callback 或 cache key |

管理命令可以展示用户需要复制的资源 ID，例如 Run ID、Attempt locator 和 Sandbox ID。这些 ID 是公开操作句柄，
不同于只用于实现关联的 failure ID、BuildKey 或 timing node ID。

## 错误只保留真实事实

通用运行错误使用以下形状：

```text
╭─ ERRORS ───────────────────────────────────── 6 attempts not started ─╮
│ install/canary · Sandbox image build failed                           │
│                                                                       │
│ error: failed to connect to the Docker API at                         │
│   unix:///var/run/docker.sock: connect: no such file or directory     │
│                                                                       │
│ details: niceeval show --run                                          │
│   8f3d6f62-1d34-4cf3-99c7-84ba3c483706                               │
╰───────────────────────────────────────────────────────────────────────╯
```

`error:` 是 Provider、SDK、CLI 或 runtime 交付的真实错误。它可以经过以下处理：

- 删除 credential、Authorization header、cookie、带凭据 URL 和其它秘密；
- 按 UTF-8 byte budget 限制大小；
- 按终端显示宽度折行；
- 保留安全的 HTTP status、Provider error code 和 request ID；
- 超出 Human budget 时保留能识别失败的有界正文，并提供下钻命令。

Human 不增加 `cause:`。无法证明的归因不能包装成事实，可靠分类也不应替换原始错误。

Human 不增加通用 `fix:`。Vercel、E2B、Docker、远端 API、网络、账号和权限错误无法由 NiceEval 穷举，推测式修复会误导用户。命令语法属于有限状态时可以展示 `usage:`；文档入口可以展示 `docs:`，两者都不冒充运行错误修复。

## 下钻入口

下钻命令取决于错误发生时是否已经存在 Attempt：

| 状态 | Human 下钻 |
|---|---|
| Attempt 已创建 | `details: niceeval show @<locator>` |
| Attempt 创建前失败 | `details: niceeval show --run <runId>` |
| 需要运行轨迹 | 在 Attempt locator 命令后追加 `--execution` |

Attempt 创建前不能制造 locator。结束摘要已经按形态聚合多条 Attempt 时，代表 locator 只能代表一条 Attempt；各 Run 的 `show --run` 负责枚举其余 locator。

## 聚合不能改变错误含义

聚合只减少重复，不能用一条代表错误代替其它错误。

Run-owned shared failure identity 只在一个 Run 内关联同一次物理失败。实现可以用 `(runId, failureId)` 分组，但 Human 不展示 `failureId`。两个 Run 即使内部都使用 `n1`，仍必须独立判断和展示；它们可能来自不同 Provider，并具有不同错误正文。

同一错误影响多个 Eval 或 Attempt 时，Human 可以显示用户可理解的数量和名称。数量描述对象必须明确，例如 `6 attempts not started` 或 `4 evals affected`，不能只写 `6 slots`。

## `show --run` 的错误优先级

Run 没有创建任何 Attempt 时，默认 `show --run` 先展示阻止运行的真实错误和计划中未启动的 Attempt。下列空信息应省略：

- `Pass rate: no data`；
- `Included attempts: 0`；
- 空的 Assessment evidence；
- 由缺少 Attempt 派生出的 Analysis notes。

内部 membership 表可以留在机器输出或高级诊断视图。默认 Human 不需要 `Membership`、`Relation`、`Selected run`、`Slot` 或 `Shared failure` 列。

## `debug` 的边界

`niceeval debug` 面向 Experiment 作者，可以展示 lifecycle、Provider、template 和声明命令等作者概念。它仍不展示无助于理解计划的内部 ID。

当运行前无法知道 callback 内容时，Human 写 `details available at runtime`；机器面可以继续使用稳定的 `Opaque` variant。`Exact`、`Redacted` 和 `Opaque` 若在 Human 中保留，必须在同一输出或帮助入口给出普通语言解释。

## BDD 预期行为

### 不泄露共享失败 ID

Given 两个 Run 的内部 shared failure ID 都是 `n1`。
And 两个 Run 的错误正文不同。
When 用户运行同一次 `niceeval exp` 并查看 Human 结束反馈。
Then 输出分别展示两个 Run 的真实 `error:`。
And 输出不包含 `n1`、`failureId` 或 `shared failure`。

### Attempt 创建前使用 Run 下钻

Given Sandbox image build 在 Attempt 创建前失败。
When Human 输出该错误。
Then 数量写成未启动的 Attempt 数。
And `details:` 使用 `niceeval show --run <runId>`。
And 输出不制造 `@locator`。

### Attempt 失败使用 locator 下钻

Given 两条已创建 Attempt 因不同原因失败。
When Human 输出失败摘要。
Then 每条独立展开的失败保留自己的真实错误或 Assertion 摘要。
And 每条提供自己的 `niceeval show @<locator>`。
And 一条代表错误不能替另一条声明具体原因。

### 未知 Provider 错误不推测

Given E2B、Vercel 或 custom Provider 返回安全过滤后的错误。
When NiceEval 无法从稳定结构判断更多事实。
Then Human 原样展示有界 `error:`。
And 不展示 `cause:` 或 `fix:`。
And JSON 保留安全的结构化 status、code、message 与内部关联字段。

### 默认 Run 视图不展示空分析

Given 一个 Run 在 Attempt 创建前失败。
When 用户运行 `niceeval show --run <runId>`。
Then 输出以阻止运行的错误为主。
And 不显示空 pass rate、空 evidence 或缺少 logical Slot input 的内部 Analysis note。

### Human 数量说明对象

Given 六个 planned Attempt 因同一错误没有启动。
When Human 输出影响数量。
Then 输出写 `6 attempts not started`。
And 不写 `6 slots`。

### 默认 Run 视图使用用户字段

Given 一个 Run 同时包含完成、未启动和使用历史结果的计划项。
When 用户运行 `niceeval show --run <runId>`。
Then Human 使用 `Attempt #N`、结果和历史 locator 说明每项状态。
And Human 不显示 Membership、Slot、Relation 或空 Analysis note。
And `show --json` 继续保留稳定机器字段。

### 管理命令保留公开句柄

Given 用户运行 `niceeval sandbox list`。
When 某个 Sandbox 可以进入或删除。
Then Human 显示 Sandbox ID 和对应命令。
And Human 不显示 registry、lease 或 Provider SDK 的内部身份。

## 不改变的边界

这套设计不改变 Record schema、Analysis domain view、failure identity 或 Provider error 类型。变化主要发生在 Human projection 和默认 Report presentation；机器消费者继续读取既有稳定字段。Attempt 创建前的 Judge 预检 warning 另补可选的 `experimentId`、`evalId`、`planned` 与 `errored`，不制造 locator。
