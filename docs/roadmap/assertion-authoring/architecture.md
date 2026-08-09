# Assertion 作者面 —— Architecture

本页定义结构化 command、工具输入与 Sandbox diff 怎样成为评估事实，以及事实怎样进入判定与计分用途。
公开调用见 [Library](library.md)，inline 关系见 [Rule](matching.md)。

## 分层

```text
Adapter native protocol
  │ 显式、版本化映射
  ▼
Original command + standard logical normalizer
  │ durable Observation + evidenceCoverage
  ▼
Evaluation Fact graph
  │ 每个节点只求值一次
  ▼
FactResult[] + FactUseResult[]
  │ 显式 assert / require / score 用途
  ▼
Pass Verdict 或 Score Attempt status
```

Adapter 负责解释原生协议。
core 不按工具名、JSON key 或显示文本猜 command；Fact evaluator 也不读取 Adapter 私有 transcript。

## Fact、matcher 与用途分层

Value matcher 是 `value → evaluation` 的纯函数。
它不知道 Eval 类型、调用 scope、判定用途或计分用途。

`t.check()` 先读取可能的 `EvidenceSource<T>`，再把唯一 candidate 交给 matcher。
作用域与 Sandbox 方法直接建立同类 Fact 节点，所有节点都由当前 `t` 管理。

布尔与连续评分使用不同品牌类型。
只有布尔 matcher 可以进入 `and()` / `or()`；Score matcher 产出独立的 Score Fact。

Fact 没有默认严重度或默认读数。
`assert` 与 `require` 建立判定用途，`score` 建立计分用途；调用顺序不能改变 Fact 自身结果。

组合 matcher 全量、顺序求值子项以保留诊断。
确定逻辑结果不会吞掉 evaluator exception；matcher 抛出、返回越界 score 或非法 result envelope 都是 defect，必须让 Attempt errored。

具名 `satisfies()`、`defineValueMatch()` 与 `defineScoreMatch()` 是 value-only 扩展边界。
自定义 evaluator 只能返回 boolean 或 `[0,1]` score，不能自行声明 unavailable；标准 EvidenceSource、coverage-aware matcher 与 provider 才拥有证据缺席分类。
现有 Judge 的 unavailable 继续由隔离的 legacy bridge 保存，不扩张普通 Fact 作者面。

## Fact 图与求值时机

每个 Fact 是当前 Attempt 内的私有品牌节点。
节点保存 producer 位置、phase、依赖边和 evaluator；判定与计分用途各自保存 consumer 位置。

| Fact producer | Phase | 求值材料 |
|---|---|---|
| Turn | `now` | 该 Turn 的不可变事件、状态与 usage |
| Agent Session | `now` | Fact 创建处的 session snapshot |
| 立即值 `t.check(value, matcher)` | `now` | 传入的同一个 value |
| `t` 聚合作用域 | `final` | Attempt 的全部 Agent Session 与 Turn |
| Sandbox diff、延迟 file source | `final` | Agent 归因完成后的最终材料 |

`require` 只接受 `now` Fact，避免用尚未封口的全 Attempt 事实控制中途代码。
Agent Session Fact 的 snapshot 在创建处固定；后续 send 不会回写已经创建的节点。

一个 Fact 最多有一个判定用途和一个计分用途，两者可以同时存在。
同一节点无论被两个用途怎样读取都只运行 evaluator 一次，结果与证据由两个用途按 `factId` 共用。

Fact 可以依赖其它 Fact。
依赖边方向固定为“当前 Fact → 它读取的 dependency Fact”，`dependencyFactIds` 保存这组出边。
FactUse 是遍历根，不是图节点：从每个 fact-backed 判定或计分用途引用的 `factId` 出发，沿 `dependencyFactIds` 递归可达的节点都算已消费。
实现不能只检查“是否直接传给某个方法”，也不能反向从 dependency 寻找 consumer。

正常路径到达受管边界时，不在上述根集合可达闭包里的 Fact 属于 author error。
受管边界包括 `send`、Sandbox 操作、`require`、legacy Judge `.stopOnFailure()` 的 evaluator 入口、`skip`、`finishScore` 与 `test` 正常返回。
legacy Judge stop 必须在调用 evaluator 前完成 dangling Fact 检查和 requirement 生命周期检查。
检查失败时不得发起 Judge 模型调用，也不得绕过已经保存的受管终止状态。

`require(fact)` 必须先原子登记判定用途，使该用途立即成为遍历根，再检查其它悬空节点。
返回的受管 thenable 使用以下生命周期：

- 初始是 `created`；调用 `await` 或 `.then(...)` 后进入 `observed-pending`；Fact 与登记的 continuation 都完成后进入 `settled`；
- 下一个由 Eval 作者发起的受管边界看到 `created` 时，报告“requirement 未观察”；看到 `observed-pending` 时，报告“依赖尚未完成就继续执行”；
- `require` 自己为了求值 Fact 而进入的内部边界不触发这项检查；
- 只调用 `.then(...)` 却立即继续调用 `send`，或丢下尚未 settle 的链后正常返回，都不能冒充完成了控制流依赖；
- 普通写法仍是 `await t.require(...)`；显式 `.then(...)` 只有在其登记的 continuation 已 settle 后才允许代码进入下一个受管边界。

Requirement settled 还携带 `passed | failed | unavailable` 结果。
只有 passed 会重新开放作者控制流；failed / unavailable 在 settle 前先把 collector 标成受管终止，作者即使 catch thenable 的 rejection 也不能重新打开路径。
后续每个受管入口都重发同一控制信号，test 收尾把它识别为合法终止，而不是 execution error。
已经登记但因这次终止未求值的 Fact 与用途写 `notReachedByControl`；从未执行到的源码调用不会伪造 Record 节点。

外部异常发生时保留原始根因。
尚未到达的节点和用途写成 `notReachedByError`，悬空检查不能用新的 author error 掩盖 agent、execution 或 evaluator error。

## Legacy Judge bridge

本轮不修改 `t.judge.autoevals.*`、`turn.judge.autoevals.*`、`JudgeNamespace`、Judge 配置或模型调用。
现有 `buildJudge()` 继续只通过注入的 `deps.record(spec)` 接触 Assertion collector；实现把这一个注入点接到私有 `recordLegacyJudge(spec)`，不改三个 autoevals 方法本身。

adapter 保留 Judge 句柄现有的 `.gate()`、`.atLeast()`、`.soft()`、`.optional()`、`.stopOnFailure()` 与计分制 `.points()` 语义，且每个 spec 仍只执行 evaluator 一次。
它的结果不伪装成普通 FactUse，也不参加 Fact 可达性和重复消费检查，而是作为 `legacyJudgeAssertions` sidecar 进入 Attempt 的既有 Verdict、质量分和计分折叠。
这使旧链式策略被限制在 LLM 边界，没有成为新 Fact producer 的通用能力。

`recordLegacyJudge(spec)` 在调用点只分配源码位置、`sourceOrder` 并登记私有可变 spec，不提前固化完整 policy。
它返回与现在相同的 Judge handle；后续链式方法只修改这条私有 spec。
`.stopOnFailure()` 需要就地求值时冻结一次 evaluator 原始结果，其余 spec 在 finalize 求值。
collector 关闭时再把最终 policy 与结果原子快照成 `LegacyJudgeAssertionResult`；受管终止路径必须在 rejection 前完成这次关闭。

`recordLegacyJudge` 是模块私有迁移缝，不导出 `JudgeFact`、matcher 或新的作者方法。
以后移除这项 sidecar 属于单独的公开 Judge API 变更，不能在 Fact 实现中顺手完成。

context 类型把普通领域方法的 Fact 返回类型与 Judge 的旧 handle 类型拆成两个泛型。
通过制的 `t.judge` / `turn.judge` 仍是 `JudgeNamespace<AssertionHandle>`，计分制仍是 `JudgeNamespace<ScoreAssertionHandle>`；普通作用域方法不再因这个泛型而返回 handle。
`src/assertions/judge.ts` 与三个 autoevals 方法保持不变，只有 context 注入的 `record` callback 改接 `recordLegacyJudge`。

Legacy Judge 的旧字段只在 adapter 内按下表折叠：

| Judge 结果 | Pass Attempt | Score Attempt | 分数 |
|---|---|---|---|
| gate failed | `failed` | `invalid` | 有 `points` 时仍进入 `earnedScore` 诊断，credited 固定 0 |
| soft / atLeast failed | 不改变 Verdict | 不改变 status | 继续进入 legacy `examScore`；只有显式 `points` 才进入 `earnedScore` |
| non-optional unavailable | `errored` | `unavailable` | 没有 earned points |
| optional unavailable | 不改变 Verdict | 不改变 status | 没有 earned points，sidecar 仍保留 reason |
| evaluator throw / reject | `errored` | `errored` | 已有 earned points 只作诊断 |

`.stopOnFailure()` 只保留旧控制流语义，本身不改变表中的判定。
因此 soft / atLeast failed 后停止仍可能得到 passed 或 scored；这是被隔离的现有 Judge 行为，不推广给 Fact。
`--strict` 已删除，不能把 legacy soft failure 提级。

未通过的 legacy Judge `.stopOnFailure()` 是另一条受管终止路径，不要求执行到 `finishScore()`。
它同样在返回 rejection 前关闭 collector；catch 不能让后续 Fact 或 Judge 登记继续生效。
停止点的 Judge spec 本身算已登记的 evaluation，因此 Judge-only Pass / Score Eval 不会被空测试守护误报；soft Judge 没有 `points` 时仍只进入 `examScore`，`earnedScore` 保持 0。

Score Attempt 的 `earnedScore` 是三项之和：成功 Fact score use 的 `earned`、direct score 的 `earned`、已求值 `LegacyJudgeAssertionResult` 的 `earnedPoints`。
计分制 Judge `.points(n)` 算一个计分声明，满足 `finishScore()` 的“至少一个计分用途”要求；optional unavailable 时该声明贡献 0，non-optional unavailable 仍使 Attempt unavailable。

Legacy Judge gate 已失败后再遇到 unavailable 或 evaluator error，仍按 Score Attempt 的已知失败优先规则得到 invalid。
后两个问题写入 `issues`，其中 unavailable issue 使用 `legacyJudgeSourceOrder` 定位 sidecar。
整个 Attempt 才是携带单位：sidecar 不单独携入另一条 Fact trace；Judge 配置和 Eval source 继续参加 fingerprint，携带命中时不重新调用模型。

## Command projection

每笔 tool `operation.started` 都携带穷尽的 command classification：

```ts
type CommandProjection =
  | { readonly kind: "not-command" }
  | {
      readonly kind: "command";
      readonly original:
        | {
            readonly state: "available";
            readonly executable: string;
            readonly args: readonly string[];
          }
        | {
            readonly state: "opaque";
            readonly reason:
              | "redacted"
              | "truncated"
              | "compound-shell"
              | "dynamic-shell"
              | "unsupported-protocol";
          };
      readonly logical:
        | {
            readonly state: "available";
            readonly executable: string;
            readonly args: readonly string[];
            readonly normalizer: "logical-command/v1";
            readonly normalization: "identity" | "pnpm-exec" | "npx";
          }
        | {
            readonly state: "opaque";
            readonly normalizer: "logical-command/v1";
            readonly reason: "original-opaque";
            readonly originalReason:
              | "redacted"
              | "truncated"
              | "compound-shell"
              | "dynamic-shell"
              | "unsupported-protocol";
          }
        | {
            readonly state: "opaque";
            readonly normalizer: "logical-command/v1";
            readonly reason:
              | "unsupported-wrapper-form"
              | "ambiguous-wrapper-target"
              | "multiple-executions";
          };
    };
```

Adapter 只有在原生协议直接提供 argv，或能按该协议明确声明的 grammar 无歧义取得单一 invocation 时，才能把 original 标为 available。
复合 shell、动态展开、管道或无法确认 quoting 的 source 在 Adapter 边界直接成为 original opaque，不能靠空格 split 伪造 argv，也不交给 normalizer 再猜。

Observation Protocol 的唯一 `logical-command/v1` normalizer 只消费 available original tokens。
它保留 direct command，并把 exact `pnpm exec <target> ...`、`pnpm --silent exec <target> ...` 与无 runner-option 的 exact `npx <target> ...` 投影成 target 的 logical executable / args。
`--silent` 属于 original runner args，不进入 logical args；child 边界后的未知 flag 则原样保留。

该 normalizer 不做 basename、PATH resolution 或开放式 wrapper 猜测。
未知 pnpm runner flag、递归执行、歧义 target 与不支持的 npx form 保留 available original、logical opaque；`npm exec`、yarn、bun、dlx、corepack 与绝对路径 runner 按 identity 处理。

logical command 表示用户请求的逻辑 CLI，不证明 package provenance、版本或物理 binary identity。
因此 direct `niceeval`、`pnpm exec niceeval`、`pnpm --silent exec niceeval` 与 `npx niceeval` 都能满足同一个 `executable: "niceeval"`。
诊断只能说“匹配逻辑命令”，不能说定位或执行了某个特定 binary。

## Logical tool occurrence

```ts
interface LogicalToolOccurrence {
  readonly id: string;
  readonly session: string;
  readonly turn: string;
  readonly name: {
    readonly original: string;
    readonly canonical?: string;
  };
  readonly input:
    | { readonly state: "complete"; readonly value: JsonValue }
    | { readonly state: "partial"; readonly value: JsonValue; readonly opaquePointers: readonly string[]; readonly reason: string }
    | { readonly state: "unavailable"; readonly reason: string };
  readonly command: CommandProjection;
  readonly start: EventPosition;
  readonly lifecycle:
    | { readonly state: "available"; readonly status: "pending" }
    | { readonly state: "available"; readonly status: "completed" | "failed" | "rejected"; readonly finish: EventPosition }
    | { readonly state: "opaque"; readonly reason: "partial-stream" | "missing-lifecycle-evidence" };
}
```

command 是同一笔 tool occurrence 的标准投影，不拥有第二个 identity。
`commandMatch()`、`toolMatch()` 与 lifecycle status 都在这组 occurrence 上运行。

只有可信 `TurnOutcome.waiting` 下仍未解决的 operation，或原生协议明确提供的 pending，才产生 available pending。partial stream 中只观察到 start、没有可信 finish 时，lifecycle 必须 opaque，不能把“没有看见结束”冒充 definite pending。

started 与 finished 按流位置配对并绑定唯一 occurrence identity。`operationId` 是允许一笔 operation 结束后复用的配对 token，不是可以放进全局 Map 后永久引用的 occurrence identity。

orphan finish 没有可信 start、input 或 command classification。
它只能进入协议诊断，不能满足 `commandMatch()`。

## Actions coverage

Adapter 只有同时满足以下条件，才能声明 `actions: complete`：

1. 原生协议中的全部 action occurrences 都进入标准事件流；
2. 每笔 tool occurrence 都有 command / not-command classification；
3. 原生协议明确提供的 input 全部保留；
4. 没有无法识别的 action kind、丢失的 start 或未交代的截断。

logical invocation opaque 不必自动降低整个 actions channel。
它表示 occurrence 集合已知，但依赖 invocation 的 match 仍可能 unavailable。

Adapter 无法判断 command / not-command 时必须降低 actions coverage。
它不能因为工具名是 `shell`，或 input 含 `command`、`cmd`、`program`、`args` 而宣称 complete。

## `commandMatch()` 真值

一笔 occurrence 的 command 字段只读取 logical，有三种结果：

| Evidence | Result |
|---|---|
| logical available，executable、prefix 与 excludes 全满足 | definite match |
| logical available，任一条件不满足 | definite mismatch |
| logical opaque | indeterminate |
| not-command | definite mismatch |

`toolMatch()` 的 name、input 与 status，以及 `commandMatch()` 的 logical command 与 status，都使用同一份单 occurrence 三值 evaluator。
`and(commandMatch(...), toolMatch(...))` 也在该 occurrence 上求值。

output 在 Observation Protocol 能区分 absent 与 opaque 前不进入公共 matcher。
任一字段 definite mismatch 就使整笔 occurrence definite mismatch；全部字段 definite match 才是 definite match；其余才是 indeterminate。
因此与其它字段已经矛盾的 opaque command 不会污染候选集合，false 压过 unknown。

`calledTool()` 找到满足 match 的 definite occurrence 就可 passed；省略 status 不附加 lifecycle 条件。
没有 definite match，且 actions complete、没有 compatible indeterminate candidate 时 failed；其余是 unavailable。

负存在性与 count 复用同一 occurrence 真值：

- `notCalledTool()` 发现 definite match 立即 failed；compatible indeterminate candidate 或 partial actions 使结果 unavailable；只有 complete 且没有 possible match 才 passed；
- exact count 的 definite matches 已超过 expected 时立即 failed；只有 actions complete、没有 indeterminate candidate 且 definite count 等于 expected 才 passed；
- definite count 尚未超额，但 partial / indeterminate 仍可能改变 exact count 时 unavailable；

exact count 必须是正 safe integer，零次使用负存在性断言。tool count 按 distinct occurrence identity；event count 按 distinct event identity。

## `toolOrder()` 顺序

`toolOrder()` 按 request position 对 logical tool occurrences 做子序列匹配。
每个 `ToolMatch` 只描述单个 occurrence；exact count 留在集合断言的第二参数。直接传 selector 对象与 string shorthand 都不进入登记边界。

算法对同一组 occurrence 计算两条子序列关系：definite path 只接受 definite match；possible path 接受 definite match 或 indeterminate candidate。
两者都按单调 cursor 消费不同 actual index，不相关工具可以穿插；一笔 occurrence 不能占两个 match，`multiple-executions` 也不会被拆成多笔。

- 存在 definite path 时 passed，即使 actions partial；
- 没有 definite path，但存在 possible path 时 unavailable；
- observed occurrences 没有 possible path、但 actions partial 时 unavailable；
- 只有 actions complete 且没有 possible path 时 failed。

例如 `[A? opaque, B definite]` 对 `[A, B]` 是 unavailable；`[B definite, A definite]` 在 complete channel 上 failed；唯一一笔同时可能匹配 A / B 的 occurrence 不能复用，因此在 complete channel 上 failed。

`toolMatch(..., { status: "completed" })` 或 `commandMatch(..., { status: "completed" })` 只证明该 occurrence 最终 completed。
它不证明前一项 finish 早于后一项 start，也不建立工具输出被下一步消费的因果关系。

`toolOrder()` 不证明动态 locator 被后续命令复用、show 输出影响了后续动作，或最终 reply 基于这些证据。
它不增加 message selector，也不冒充因果检查。

## Command 诊断与脱敏

FactResult 不把 argv 重新拼成仿真 shell text。
passed、failed 与 unavailable 都用有界 token 数组展示 `original.argv`、`logical.argv`、normalizer 与 normalization / opaque reason。
logical match 的文案固定说明它是逻辑命令请求，不是物理 binary provenance。

original 与 logical preview 复用 Observation Record 已执行的 secret redaction、truncation 与预算结果。
Assertion evaluator 不复制未脱敏 argv，也不从 tool input 重建一份旁路 evidence。
`toolOrder()` unavailable 必须指出第一个无法确定的 match index、normalizer 和 opaque reason，不能误报成“未调用 niceeval”。

候选 matcher 的内部结果使用 `matched | mismatched | unavailable`，不复用 Fact 的 `passed | failed | unavailable`。
一笔 candidate mismatch 不等于集合 Fact failed。

组合诊断按组合树与子项索引保留，再经既有脱敏、截断与预算规则映射到 FactResult。
任何 matcher defect 都不能被另一个决定性分支吞掉。

### show 诊断形状

以下文本是本 Roadmap 要求 `niceeval show @locator` 产生的具体投影，不是伪造一套调试对象。
实现可以调整缩进与截断宽度，但不能丢掉 matcher tree、决定分支、coverage reason 或 occurrence 定位。

`and()` 失败时，`assert` 的 label 只替换用途标题，matcher 仍留在 Fact detail：

```text
✗ assert · runtime tag
    fact: and(includes("runtime:python"), excludes("runtime:node"))
    expected: all 2 matchers matched
    received: "image: runtime:node"
    evidence:
      [0] mismatched · expected contains "runtime:python"
      [1] mismatched · expected excludes "runtime:node"
```

logical command opaque 时，集合 Assertion 不能把 unavailable 降成“没有调用”：

```text
◌ unavailable · assert · turn1 · calledTool(commandMatch("niceeval", argsStart=["show"]))
    expected: logical executable "niceeval", argv starts ["show"]
    reason: logical-command-opaque: compound-shell
    evidence: occurrence turn1/op3 · original=opaque · logical-command/v1
```

工具输入 partial 且没有可见命中时，负存在性也不能通过：

```text
◌ unavailable · turn1 · notCalledTool(toolMatch(input=referencesAnyPath(3 paths)))
    expected: no observed occurrence definitely references a forbidden path
    reason: tool-input-coverage-partial
    evidence: occurrence turn1/op4 · opaquePointers=["/command"]
```

负存在性包住 `or()` 时，失败输出必须定位命中的 occurrence 与决定分支：

```text
✗ assert · turn1 · notCalledTool(or(toolMatch("read_file"), toolMatch("file_read")))
    expected: no occurrence matched either branch
    received: occurrence turn1/op2 · name="read_file"
    evidence:
      [0] matched · tool name exactly "read_file"
      [1] mismatched · tool name was not "file_read"
```

这些 preview 全部经过既有 secret redaction、控制字节移除与大小预算。
完整 matcher spec 与原始未脱敏输入不会因诊断需要被旁路保存。

## 工具输入负断言

工具输入负约束复用 `notCalledTool(toolMatch({ input }))`，不增加路径专用 scoped method。它只检查标准 tool occurrence 的 input evidence，不检查 stdout、assistant reply、子进程变量集合、文件描述符或 OS syscall。

walker 只访问 plain JSON value：

- object 按 own enumerable string keys 遍历 value，不检查 key；
- array 按 index 遍历；
- 不调用 getter、`toJSON` 或 `String()`；
- number、boolean 与 null 不进入路径匹配。

`referencesAnyPath()` 还携带私有的 positive-witness capability，让 occurrence evaluator 在 partial input 上保持以下三态：

| Input evidence | Matcher result |
|---|---|
| 任一可见 string leaf definite path match | matched；新增隐藏 leaf 不能推翻该 witness |
| complete、全部可遍历且没有 match | mismatched |
| partial / unavailable 且没有可见 match | unavailable |

任一 occurrence matched 时，`notCalledTool()` 立即 failed；没有 matched、actions complete 且没有 unavailable candidate 时 passed；其余 unavailable。已知命中不依赖完整 coverage，但 evaluator defect 不能被短路掩盖。

actions complete 却携带 partial / unavailable input 是 Observation Protocol defect。actions partial 与某笔 input partial 可以共存；不能把经过截断或脱敏的 `JsonValue` 当成完整 candidate 扫描。

失败诊断包含 tool occurrence、string leaf 的 JSON Pointer 与命中的规范化 pattern，received preview 继续使用既有脱敏和预算。通过文案必须写成“observed tool-input string leaves 未引用目标路径”。
它不能写成“Agent 没有读取文件”。

## Sandbox diff collector

`t.sandbox` 消费 Runner 已有的 agent 归因 diff。
fixture、Eval 自己的验证命令与 Agent 完成后的材料写入不进入该 diff。

`changedPaths()`、`noChanges()`、`fileChanged()` 与 `fileDeleted()` 共用一份 collector。
path set 是 `diff.files` 的 normalized keys；净改回原样仍保留在集合，因为范围纪律关心 Agent 是否触及。

exact set 的三值规则是：

- 已观察到 expected 外的确定 path，立即 failed；
- collector complete 时，集合相等 passed，不等 failed；
- collector partial 且尚无矛盾时 unavailable。

`noChanges()` 固定 expected 为空集。
它不是另一套“diff 文本为空”检查。

### 同一条 change 的前后文本

带 before / after matcher 的 `fileChanged()` 在 agent diff 的 send 区间中寻找一条同时满足 path、kind 与内容条件的 entry。
两个 matcher 不能分别由不同 send 区间满足。

available UTF-8 内容交给对应的 string `BooleanMatch`。
binary、oversized 或 provider 不支持内容证据时是 unavailable；确定缺少 before / after 或文本不命中时 failed。

该断言只证明 before / after 各自满足声明的 matcher。
它不证明只修改了一个 token，也不把内容重新读取为最终文件后再冒充 change evidence。

## 延迟 Sandbox file

`t.sandbox.file(path)` 创建惰性 source，不立即 I/O。
`t.check()` finalize 或 awaited control boundary 到达时，file source reader 执行一次 read 与 strict UTF-8 decode。

missing 与 invalid UTF-8 是 candidate failed。
permission、transport、timeout 与 terminated 表示拿不到 candidate，因此 unavailable；provider 返回非法 envelope 才是 defect。

本 Roadmap 不提供延迟 JSON source。
JSON syntax failure 的分类问题因此不会进入 Assertion API；应用自己取得的任意值继续使用现有 value assertion。

## usage 适用范围

`assertIfCovered()` 只接受 core 私有品牌的 usage Fact。
它不能按 reason 字符串猜测证据 producer。
Fact 必须携带结构化的 Agent 创建时支持声明、有效证据完整度、所需通道与降级 provenance。

求值顺序固定为：

1. 先运行 Fact evaluator；
2. 得到 definite passed 或 failed 时保留该结果；
3. 只有 unavailable 完全由 Agent 创建时的 usage unavailable 引起，才把判定用途记为 `notApplicable`；
4. Agent 创建时声明 complete，运行中降级为 partial 或 unavailable 时保留 unavailable。

这条规则只表达“该 Agent 接入面没有 usage 证据”，不表达任意运行失败都可以忽略。
Legacy Judge、Sandbox、普通 matcher 与自定义 evaluator 的 unavailable 不能进入该分支。

## Record 形状

Fact 求值结果与 Fact 用途结果分开落盘。
消费方不能再从 severity、points 或 optional 的字段组合推断一项用途扮演什么角色。

```ts
interface AttemptError {
  readonly class: "agent" | "execution" | "author" | "evaluator";
  readonly code: string;
  readonly message: string;
}

interface EvaluatorError extends AttemptError {
  readonly class: "evaluator";
}

interface FactResultBase {
  readonly factId: string;
  readonly name: string;
  readonly groupPath?: readonly string[];
  readonly producerLoc?: SourceLoc;
  readonly sourceOrder: number;
  readonly dependencyFactIds: readonly string[];
  readonly expected?: string;
  readonly received?: string;
  readonly evidence?: string;
}

type EvaluationFactResult =
  | (FactResultBase & {
      readonly factKind: "boolean";
      readonly outcome: "passed" | "failed";
    })
  | (FactResultBase & {
      readonly factKind: "score";
      readonly outcome: "scored";
      readonly normalizedScore: number;
    })
  | (FactResultBase & {
      readonly factKind: "boolean" | "score";
      readonly outcome: "unavailable";
      readonly reason: string;
    })
  | (FactResultBase & {
      readonly factKind: "boolean" | "score";
      readonly outcome: "errored";
      readonly error: EvaluatorError;
    })
  | (FactResultBase & {
      readonly factKind: "boolean" | "score";
      readonly outcome: "notReachedByControl" | "notReachedByError";
      readonly reason: string;
    });

interface FactUseBase {
  readonly key?: string;
  readonly consumerLoc?: SourceLoc;
  readonly sourceOrder: number;
}

interface VerdictFactUseBase extends FactUseBase {
  readonly useKind: "verdict";
  readonly method: "assert" | "require" | "assertIfCovered";
  readonly label?: string;
  readonly target:
    | { readonly kind: "boolean"; readonly factId: string }
    | { readonly kind: "score"; readonly factId: string; readonly atLeast: number };
}

type VerdictFactUseResult = VerdictFactUseBase &
  (
    | { readonly outcome: "passed" | "failed" }
    | { readonly outcome: "unavailable" | "notApplicable"; readonly reason: string }
    | { readonly outcome: "errored"; readonly error: AttemptError }
    | {
        readonly outcome: "notReachedByControl" | "notReachedByError";
        readonly reason: string;
      }
  );

interface ScoreFactUseBase extends FactUseBase {
  readonly useKind: "score";
  readonly label: string;
}

type ScoreFactUseResult =
  | (ScoreFactUseBase & {
      readonly input: { readonly kind: "direct"; readonly earned: number };
      readonly outcome: "scored";
      readonly earned: number;
    })
  | (ScoreFactUseBase &
      {
        readonly input: { readonly kind: "fact"; readonly factId: string; readonly max: number };
      } &
      (
        | { readonly outcome: "scored"; readonly earned: number }
        | { readonly outcome: "unavailable"; readonly reason: string }
        | { readonly outcome: "errored"; readonly error: AttemptError }
        | {
            readonly outcome: "notReachedByControl" | "notReachedByError";
            readonly reason: string;
          }
      ));

type FactUseResult = VerdictFactUseResult | ScoreFactUseResult;
```

`producerLoc` 指向事实声明位置，`consumerLoc` 分别指向 `assert`、`require` 或 `score` 调用位置。
同一 Fact 同时用于判定和计分时，两种位置都保留，源码视图不能只展示其中一行。

`key` 属于 Fact use，不属于 Fact。
inline Eval 可以省略；replayable Grading 的每个 use 都必须提供，并在单个 GradingDefinition 内唯一。

key 用于跨 Grading 对齐同一项作者声明。
它不替代 `factId`、Claim opaque identity、content digest 或 EvidenceTarget；`label` 改动也不能暗中改写 key。

`EvaluationFactResult[]` 与 `FactUseResult[]` 存在于 Attempt 的所有终态。
失败、证据不足、显式跳过和执行错误都保留此前已经取得的事实、用途与分数，不能只给成功 variant 填数据。

## Live 与 replay selector

live `t`、Agent Session 与 Turn，以及 replay grading 的 Attempt、SessionRef 与 TurnRef，复用同一个 ScopedFacts evaluator。
复用的是 evaluator 与明确 selector，不是把不同时间边界伪装成同一个 receiver。

| Selector | Evidence boundary |
|---|---|
| live Turn | 一个 immutable Turn |
| live Agent Session | Fact 创建时的 session prefix snapshot |
| replay TurnRef | sealed Execution graph 中的一个 immutable Turn |
| bare replay SessionRef | 完整 sealed Agent Session |
| `sessionRef.through(turnRef)` | 截止该 Turn 的显式 session prefix |
| replay grading context | sealed Attempt 的全部 Session 与 Turn |

因此 bare replay SessionRef 不声称等价于 live Session 的“登记时前缀”。
需要相同范围时，grader 必须显式写 `through(turnRef)`。

逐 Turn Sandbox Fact 使用 `g.sandbox.during(turnRef)` 选择 send window。
Attempt 最终 diff 使用 grading context 的 bare Sandbox receiver；两者运行同一 Fact evaluator，但 evidence selector 不同。

replay grading 没有 `require()`。
Fact unavailable、matcher 或 evaluator defect 与 pass/score 折叠继续遵守本页结果契约，不另建一套离线状态。

## 通过制与计分制终态

`defineEval` 继续使用四态 Verdict：`passed | failed | errored | skipped`。
普通判定用途 unavailable 映射到 `errored`，但结构化 reason 仍保留证据不足原因；`assertIfCovered` 全部不适用时映射到 `skipped`。
单个 Pass Attempt 按 `errored > failed > skipped > passed` 折叠。
agent / execution / author / evaluator error 和非 optional legacy Judge unavailable 都进入 errored，不能被更早的 failed 掩盖。

```ts
interface LegacyJudgeResultBase {
  readonly name: `judge:${string}`;
  readonly detail: string;
  readonly groupPath?: readonly string[];
  readonly loc?: SourceLoc;
  readonly sourceOrder: number;
  readonly policy: LegacyJudgePolicy;
}

interface LegacyJudgePolicyBase {
  readonly verdict:
    | { readonly kind: "gate"; readonly atLeast: number }
    | { readonly kind: "soft"; readonly atLeast?: number };
  readonly optional: boolean;
  readonly stopOnFailure: boolean;
}

type LegacyJudgePolicy = LegacyJudgePolicyBase &
  (
    | { readonly scoring: { readonly kind: "quality" } }
    | { readonly scoring: { readonly kind: "points"; readonly max: number } }
  );

type LegacyJudgeAssertionResult =
  | (LegacyJudgeResultBase & {
      readonly policy: LegacyJudgePolicyBase & {
        readonly scoring: { readonly kind: "quality" };
      };
      readonly outcome: "passed" | "failed";
      readonly normalizedScore: number;
      readonly evidence?: string;
    })
  | (LegacyJudgeResultBase & {
      readonly policy: LegacyJudgePolicyBase & {
        readonly scoring: { readonly kind: "points"; readonly max: number };
      };
      readonly outcome: "passed" | "failed";
      readonly normalizedScore: number;
      readonly earnedPoints: number;
      readonly evidence?: string;
    })
  | (LegacyJudgeResultBase & {
      readonly outcome: "unavailable";
      readonly reason: string;
      readonly evidence?: string;
    })
  | (LegacyJudgeResultBase & {
      readonly outcome: "errored";
      readonly error: EvaluatorError;
    })
  | (LegacyJudgeResultBase & {
      readonly outcome: "notReachedByControl" | "notReachedByError";
      readonly reason: string;
    });

interface AttemptFactTrace {
  readonly facts: readonly EvaluationFactResult[];
  readonly uses: readonly FactUseResult[];
  readonly legacyJudgeAssertions: readonly LegacyJudgeAssertionResult[];
}

interface UnavailableAttemptIssue {
  readonly kind: "unavailable";
  readonly reason: string;
  readonly factId?: string;
  readonly useSourceOrder?: number;
  readonly legacyJudgeSourceOrder?: number;
}

interface ErrorAttemptIssue {
  readonly kind: "error";
  readonly error: AttemptError;
  readonly factId?: string;
  readonly useSourceOrder?: number;
  readonly legacyJudgeSourceOrder?: number;
}

type AttemptIssue = UnavailableAttemptIssue | ErrorAttemptIssue;

type PassAttemptResult = AttemptFactTrace &
  (
    | { readonly verdict: "passed" | "failed" }
    | {
        readonly verdict: "errored";
        readonly issues: readonly [AttemptIssue, ...AttemptIssue[]];
      }
    | { readonly verdict: "skipped"; readonly reason: string }
  );
```

这个 union 是 adapter 唯一允许写入 sidecar 的封闭 envelope，不复用旧版通用 `AssertionResult`。
每个已经登记的 Judge spec 都必须恰好写入一个 variant：

- 已求值得到 `passed | failed`；
- 证据不足得到 `unavailable`；
- evaluator throw / reject 得到 `errored`；
- 登记后因前序终止未执行，得到 `notReachedByControl | notReachedByError`。

尚未执行到源代码登记点的 Judge 调用不凭空生成结果。
adapter 在调用点固定 `name`、源码位置与严格递增的 `sourceOrder`，在 collector 关闭时固定完整链式 `policy`。
计分 variant 只用 `earnedPoints` 表示已挣分，不允许再靠可选 `points` 字段猜测评分模式。

Pass `errored` 的非空 `issues` 明确区分结构化 unavailable 与带 class 的真正 error，不能为证据缺口伪造 execution error。

`defineScoreEval` 使用能区分分数有效性的终态：

```ts
type ScoreIssue = AttemptIssue;

interface ScoreAttemptBase extends AttemptFactTrace {
  /** Fact score uses、direct score 与 legacy Judge earnedPoints 的诊断和。 */
  readonly earnedScore: number;
}

type ScoreAttemptResult = ScoreAttemptBase &
  (
    | { readonly status: "scored"; readonly creditedScore: number }
    | {
        readonly status: "invalid";
        readonly creditedScore: 0;
        readonly issues: readonly ScoreIssue[];
      }
    | {
        readonly status: "unavailable";
        readonly creditedScore: null;
        readonly issues: readonly [UnavailableAttemptIssue, ...UnavailableAttemptIssue[]];
      }
    | {
        readonly status: "errored";
        readonly creditedScore: null;
        readonly errors: readonly [ErrorAttemptIssue, ...ErrorAttemptIssue[]];
        readonly issues: readonly UnavailableAttemptIssue[];
      }
    | {
        readonly status: "skipped";
        readonly creditedScore: null;
        readonly reason: string;
      }
  );
```

`AttemptFactTrace` 使每个 variant 都必须携带同一组 Fact、用途与隔离的 Judge sidecar。
Fact evaluator 已经开始执行后 throw / reject 时写 `EvaluationFactResult.outcome: "errored"`；`notReachedByError` 只表示根错误发生时该 Fact 还没有开始。
`ScoreFactUseResult.outcome: "scored"` 必须携带 `earned`，不能在字段省略时让消费方猜分数。

Score Attempt 的状态按以下顺序折叠：

1. 只要已有一个判定用途或 legacy Judge gate 确定 `failed`，结果就是 `invalid`、`creditedScore: 0`；随后发生的 unavailable 或 error 进入 `issues`，不能把已知无效样本改成 `null`；
2. 尚无确定失败但出现 agent、execution、author 或 evaluator error 时是 `errored`；所有错误进入非空 `errors`，证据缺口进入 `issues`；
3. 尚无错误但任一必需判定、计分用途或非 optional legacy Judge unavailable 时是 `unavailable`；
4. 显式 `t.skip()` 且没有更早的失败或错误时是 `skipped`；
5. 其余已完成路径是 `scored`，`creditedScore === earnedScore`。

可信 Turn 的 `failed` 和受检命令的非零退出是领域事实，不是 execution error；可信 Turn 形成前的 transport 或进程失败才进入 error class。

`scored` 表示约束可用且通过，所有计分用途也可用，包括 `creditedScore: 0`。
`invalid` 表示至少一个可用硬约束失败；已挣分数只用于诊断，聚合贡献固定为 0。

例如一个 scored Attempt 挣 100 分，另一个 invalid Attempt 在硬约束外挣了 72 分，两次聚合是 `(100 + 0) / 2 = 50`。
忽略 invalid 会造成 survivor bias，按 72 聚合则会让无效结果继续获益。

`unavailable` 表示硬约束或计分用途无法求值。
它保留此前的 `earnedScore` 诊断，但 `creditedScore` 为 `null`；基础设施或证据缺口不能伪装成零分。

## Score 完成协议

`defineScoreEval.test` 的正常返回值必须是私有品牌 `ScoreCompletion`。
`finishScore()` 无参数并原子关闭 collector；正常尾部和显式提前完成使用同一个调用。
需要解释分支时，作者先写 `t.diagnostic(...)`，不把无法由运行时验证的“提前结束 reason”作为字段传入完成 token。
既没有 Fact 计分用途也没有 legacy Judge assertion，或关闭后再登记，仍是 author error。

`require` failed 产生 `invalid`，`require` unavailable 产生 `unavailable`，两者都允许在到达 `finishScore()` 前终止。
Legacy Judge `.stopOnFailure()` 未通过与 `t.skip()` 也是合法终止路径；已经取得的 Fact、用途和 sidecar 继续进入对应结果 variant。

纯计分 Eval 是零个 Fact 判定用途的合法退化态，但正常路径必须至少有一个 Fact 计分用途或 legacy Judge assertion。
通过制 Eval 正常返回时必须至少有一个 Fact 判定用途或 legacy Judge assertion，避免空测试自动变绿。

## 版本与携带

这一结果形状替换非 Judge Assertion 的 severity、optional、points 与分离的 ScoreEntry，属于破坏性 Record 变化。
`legacyJudgeAssertions` 只承载本次 Attempt 里由现有 Judge API 产生并经 adapter 归一化的封闭 `LegacyJudgeAssertionResult`，不允许其它 producer 写入。
实现必须递增 Record `schemaVersion`，并把求值常量 `evaluationAlgorithm: "fact-use/v1"` 放入 Eval fingerprint 与 Attempt Record。

带旧版通用 AssertionResult、ScoreEntry、`evaluationKind: "points"` 或 strict 配置的 Run 只按其原 schema 读取。
新读取器不根据字段组合启发式转换，也不把旧 Run 和 Fact Record 合并聚合。

目标 `evaluationKind` 是 `"pass" | "score"`。
`strict` 不进入 Run、configHash 或 fingerprint；Fact 的判定语义只来自显式用途。
Legacy Judge 继续只读其隔离 sidecar 中的现有链式策略，不允许普通 Fact 消费方解释这些字段。

通过制的 `passed | failed`、计分制的 `scored` 与 `issues.length === 0` 的 `invalid` 是可携带的可靠领域终态。
带 issue 的 invalid 仍在本次聚合中贡献 0，但不携带；下一次运行需要补齐未取得的诊断。
`errored | unavailable | skipped` 不携带，跨 Record schema 同样不携带。

## 公开诊断边界

Harness 仍需要关联 `niceeval show` 的 command、stdout、动态 locator、后续 source/execution 调用与最终建议，但本 Roadmap 不把这些关系编码成新的确定性断言。
CLI 无法呈现这些事实时，应暴露 NiceEval 呈现缺口；Eval 不能绕过 CLI 读取 `.niceeval` 私有文件，也不能要求 Agent 生成一份专供 Assertion 的 JSON。

## Error classification

以下情况在创建或消费边界报告 author error：

- 空 executable、空 command token、重复 excludes；
- `referencesAnyPath()` 的空、无效或规范化后重复 path，重复 expected changed path，空的 file change options；
- `and()` / `or()` 少于两个布尔 matcher；
- `toolOrder()` 少于两项或传入非 ToolMatch；
- exact count 不是正 safe integer；
- label 是空 string；
- Fact use key 为空、格式非法，或在同一 definition 内重复；
- `score` 的 max 不是正有限数，或 direct earned 不是非负有限数；
- 同一个 Fact 重复登记判定用途或计分用途；
- 正常路径存在不在 FactUse 根闭包内的 Fact，或 requirement thenable 在下一受管边界仍为 `created` / `observed-pending`；
- Score Eval 没有 Fact 计分用途或 legacy Judge assertion 却调用 `finishScore()`，或 collector 关闭后继续登记；
- Pass Eval 正常结束却没有 Fact 判定用途或 legacy Judge assertion。

以下情况是 failed：

- available evidence 与 rule 不匹配；
- Sandbox file missing 或 invalid UTF-8；
- complete path set 不相等。

以下情况是 unavailable：

- required coverage 不足且事实仍可能成立；
- logical command opaque；
- Sandbox permission、transport、timeout 或 terminated；
- diff 内容是 binary 或 oversized，但 Assertion 需要内容。

框架、Adapter、provider 或 evaluator 违反自身协议时，Attempt errored。
自定义 matcher throw / reject、返回非 boolean、非有限 score 或 `[0,1]` 外 score 都属于 evaluator defect。

## 防止 API 膨胀

普通 API 不共享万能 `Rule` 联合，也不提供递归 JSON AST。
`and()` / `or()` 只组合纯布尔 matcher，不拥有 observation、scope、判定用途或计分用途。
`not()` 只反转 value-domain BooleanMatch；它不进入 tool / event domain，也不替代集合负存在性。
一个新方法必须满足四个条件：有标准 observation owner、至少两个真实下游、可定义 coverage、无法由现有领域方法清楚表达。

普通路径只保留独立 Match 工厂、Fact producer 与三个明确用途。
它不允许直接传 selector 对象、string shorthand、`match.*` namespace、fluent 登记别名或通用 optional。

Harness 的输出格式、case 名和评分 rubric 留在用例，不能反向进入 core API。
