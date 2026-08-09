# 缓存与携带 —— 哪些历史 Attempt 仍可采用

Experiment 的缓存不是复制结果。
Runner 在一个明确的已提交 `RecordGraphRef` 中找到可采用的 Attempt，然后为当前 Run 写 Claim 与 `RunContribution`；执行事实仍属于 origin Run。

本页定义 carry、accept 的资格与写入语义。
Attempt、Claim、Contribution、locator 与 RecordStore 的形状由 [Record](../record/README.md) 定义。

## 携带要过的门

一条历史 Attempt 要进入当前 Run，必须同时通过以下条件。

![Attempt 采用的五道门](assets/carry-six-gates.svg)

| 条件 | 判断对象 | 不通过时 |
|---|---|---|
| 终态 | 被采用 Attempt 的 Verdict 是 `passed` 或 `failed` | 派发执行 |
| 指纹 | 该 Eval 的 fingerprint 等于当前求值后的 fingerprint | 派发执行 |
| timeout 资格 | `executionMs` 不超过当前 `timeoutMs` | 派发执行 |
| `--rerun` 口径 | 本次档位仍允许采用此 Verdict | 派发执行 |
| `--keep-sandbox` 口径 | 本次不要求该成员重新取得现场 | 派发执行 |

Runner 用 `Eligible | Blocked` 表达计划结果。
不存在、损坏、不可读、`errored` 或 `skipped` 的 Attempt 都不会被当成可采用成员。

读取候选时先固定 source `RecordGraphRef`。
无论随后 Store head 怎样推进，该次计划都不会把时间较晚写入的 Attempt 静默混进来；重新规划必须显式打开另一个 GraphRef。

## 指纹：两个哈希嵌套

每条 Eval 计算自己的 fingerprint：

```text
configHash  = hash(agent 与安装身份、model、reasoningEffort、flags、sandboxReuse、
                   sharedState.key、Experiment sandbox layer、strict、judge)

fingerprint = hash(configHash、Eval 源码闭包、evalId / tags / metadata、
                   pair-owned ProviderPlan、受管数据文件与判据树)
```

`configHash` 表达一个 Run 的已求值运行配置身份。
它与完整字段一同进入 Run Provenance；Record 不需要额外的 Run 摘要或结果文件来解释它。

layer identity 由 template-bearing factory 的纯数据 options 与已声明 command identity 组成。
直接传入的 callback 没有可追踪 identity；作者需要自动作废历史 Attempt 时，必须使用 `defineSandboxCommand()` 并维护 `revision` 与 `inputs`。

凭据不进入 fingerprint 或 Provenance。
`judge.apiKeyEnv` 只表示读取凭据的位置；Judge 的 model、baseUrl 与 timeout 属于已求值配置。

### manifest：哈希做比较，清单做解释

同一次指纹计算还产生可读的输入清单。
它列出已求值配置、项目内源码闭包和受管数据文件的 identity，供计划、人读差异与 accept Claim 的审计使用。

这个清单是 Experiments-owned Provenance 或 Claim evidence，不是 Run 下的 JSON 文件，也不成为另一套事实根。
它的引用遵守 Record 的 typed payload 与 strong-edge 规则。

fingerprint 不同但可比较时，CLI 显示具名差异，例如 `config:judge.model` 或 `source:evals/share/prompt.ts`。
不能比较时显示明确限制；空差异不能被误读为“已经证明等价”。

跨版本的等价性只能由明确迁移规则证明。
没有证明时自动 carry 必须停止；人可以检查证据后 accept，或重新执行。

## 携带资格：timeoutMs 不进哈希

`timeoutMs` 不改变已经完成的 Attempt 事实，只限制当前配置是否能合理复现它。
因此 fingerprint 不含 `timeoutMs`，但 carry 额外要求 `executionMs <= timeoutMs`；未设置 timeout 视为无上限。

提高上限不会让已完成的合格 Attempt 失去资格。
降低上限时，超过新限制的历史 Attempt 必须重新执行。

`executionMs` 与 Attempt deadline 使用同一段执行区间，不包含等待并发位的时间。
它是由 Record 中的 timing Observation 和 Projector 读取出的值，不从目录创建时间推断。

## 携带粒度：以 Attempt 为单位

`attempts: 5` 已有三个合格 Attempt 时，当前 Run 只需要补两个缺失 ordinal。
调大 attempts 只补缺失成员，调小不删除任何历史 graph entity。

每个被采用的成员都形成目标 Run 的一个 `membershipSlot`。
Runner 创建 carry Claim，并写一个 `mode: "carried"` 的 RunContribution；它的 `attempt` 是历史 Attempt 的完整 `AttemptRef`，`basisClaims` 指向该 Claim。

这一动作不会复制 Attempt、Verdict、evidence、Observation、Provenance 或 locator。
locator 始终是被采用 Attempt 的完整 128-bit identity，CLI canonical 形式为 `@` 加 26 个大写 Crockford 字符。

若历史 Attempt 后来收到迟到事实，更新遵循 Record 的线性 revision 规则。
同一个 Contribution 只能采用同一个 Attempt 的后继 revision，不能偷偷改指向另一个 Attempt。

## `niceeval accept`：接受明确列出的 Attempt

指纹不同时，操作者可以明确声明某些历史 Attempt 仍适用于当前 Experiment 配置：

```sh
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY
niceeval accept @01J8ZK3M6P4T7V9X2C5N8QW0RY @123456789ABCDEFGHJKMNPQRST
```

locator 列表是唯一作用域。
命令不接受动态 query、差异类别或批量选择器；这些输入会在 source Graph 改变时扩大或缩小授权范围。

### 原子预检与写入

`accept` 先对全部 locator 做原子预检，预检失败时零写入。
它逐项确认 locator 格式与身份、历史 Attempt 的可读性和终态、当前 Experiment 与 Eval 的发现结果、当前配置与 timeout 资格，以及当前 Sandbox pair 的可用计划。

预检通过后，命令按 Experiment 分组。
每个 Experiment 在本次 Invocation 中建立一个新 Run，并为每个显式成员写入：

1. 一条 accept Claim，保存当前配置身份、被采用 Attempt ref 与可读的差异审计；
2. 一个 `mode: "accepted"` 的 RunContribution，其 `basisClaims` 指向该 Claim；
3. 该 Run 的 immutable `RecordGraphRef` 与 receipt。

Contribution 采用原 Attempt 的明确 revision。
它不能复制或 reparent Attempt、Verdict、evidence、Observation 或 Provenance，也不能生成另一个 locator。
审计材料只在 Claim 与其 evidence refs 中出现，不复制到 Attempt 或 Contribution 的私有出处字段。

一次预检可涵盖多个 Experiment。
每个 Experiment 的 Run 都独立完成自己的 Record 提交；任何 Store 写入失败都以对应 receipt 的 `partial` 或 `not-recorded` 如实返回，而不是伪造完成态。

### 输出与错误

成功输出列出原 locator、Experiment、Run、Contribution mode 与该 Run 的 GraphRef。
同一 locator 在输出中保持不变；阅读证据仍使用该 locator 与 receipt 指向的 RecordGraphRef。

| 错误 | 含义 | 下一步 |
|---|---|---|
| `malformed-locator` | 缺少 `@`、不是 26 个字符、含非法字母或高位不合法 | 复制完整 canonical locator |
| `locator-not-found` | 当前 Record 中没有该 Attempt | 打开正确的 Record 或检查输入 |
| `accept-ineligible` | Verdict、timeout、当前发现或计划不满足条件 | 阅读说明后重新执行或修正选择 |
| `duplicate-accept-member` | 同一 Experiment 的同一 membership 重复列入 | 每个成员只给一次 locator |
| `record-head-conflict` | 提交期间 Store head 推进 | 按 returned actual head 重建并重试 |

accept 不是永久豁免。
下次输入再次变化时，fingerprint 门仍会阻止自动 carry；需要新的明确 accept 或重新执行。

## 携带不要求 Run 收尾

Attempt 一旦已完成 required stream、terminal Claim 与 Contribution 的 durable 提交，就可以成为将来计划的候选。
origin Run 后来 `incomplete` 或 Invocation 被中断，不会抹掉该 Attempt 已经可验证的事实。

重跑同一命令会在明确 GraphRef 上重新规划，只执行缺失或失去资格的成员。
这不承诺回滚 Agent 已经写入外部系统、共享数据库或未受管 checkpoint；作者仍要为外部状态提供恢复边界。

## 并发 Invocation：取到锁后重新规划

用例锁释放后，等待者打开新的明确 `RecordGraphRef` 并重新计算该 Eval 的候选。
对方已经提交的合格 Attempt 可以形成 carried Contribution；其余成员才执行。

这条 happens-before 关系来自锁的释放与 Store commit，而不是读取“最近目录”。
同一 `(experimentId, evalId)` 的 Attempt 分母仍由一个 Invocation 承接，避免两边各得到不完整的比较样本。

## 执行模式划走的一块

`sandboxReuse: true` 只描述真实派发时的 Sandbox 生命周期。
它不改变 carry、accept 或 rename 对历史 Attempt 的采用规则；被采用成员不会创建、模拟或重新获得历史 Sandbox。

`--keep-sandbox` 要求本次真实执行才能留下现场。
落入当前留存档的成员不得 carry，必须重新派发；这不改变历史 Record，也不会为历史 Attempt 补造 Sandbox 事实。

## `--rerun`：一个旋钮定哪些历史成员仍可采用

| 写法 | 可自动采用 | 本次执行 |
|---|---|---|
| 不带 | `passed` 与 `failed` | `errored`、`skipped` 与缺失 ordinal |
| `--rerun` / `--rerun failed` | `passed` | 上述成员与所有 `failed` |
| `--rerun all` | 无 | 选中矩阵中的全部成员 |

`--rerun` 只作用于这一次 Invocation，不改 fingerprint 定义，也不修改历史 Run。
需要长期表达的差异应进入公开 Experiment 配置，而不是依赖一次性重新执行。

## 相关阅读

- [Architecture](architecture.md#carry自动携带) —— Carry 进入 Run 的实体关系。
- [实验改名](rename.md) —— `renamed` Contribution 的跨 Experiment 采用。
- [Record Architecture](../record/architecture.md#runattempt-与-contribution) —— Attempt、Contribution 与 revision 的硬约束。
- [Record CLI](../record/cli.md#attemptlocator) —— locator 的 canonical 语法与错误。
