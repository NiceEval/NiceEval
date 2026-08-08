# Assertion 作者面 —— Architecture

本页定义 Assertion 怎样消费标准 Observation、延迟 Sandbox source 与 workspace delta。
公开调用形状见 [Library](library.md)，inline rule 语义见 [Rule](matching.md)。

## 分层

```text
Adapter native protocol
  │ 显式、版本化映射
  ▼
Standard Observation + evidenceCoverage
  │ core 按 operationId 合成 logical occurrence
  ▼
Scoped collector / delayed source resolver
  │ inline rule 三值求值
  ▼
AssertionResult + Claim
```

Adapter 负责解释原生协议。
core 不按工具名、JSON key 或显示文本猜标准事实；Assertion evaluator 也不反向打开 Adapter 私有 transcript。

## Command projection 的唯一 owner

CommandProjection 的权威形状由 [运行观测协议](../observation-protocol/library.md#command-projection) 定义。
它随 `operation.started` 产生，core 只把 start 与 finish 合成同一笔 logical occurrence。

```ts
type CommandProjection =
  | { readonly kind: "not-command" }
  | {
      readonly kind: "command";
      readonly source:
        | {
            readonly state: "available";
            readonly value: string;
            readonly language: "posix-shell" | "powershell" | "cmd" | "unknown";
          }
        | {
            readonly state: "opaque";
            readonly reason: "redacted" | "truncated" | "structured-only" | "unsupported";
          };
    };
```

available source 必须是原生协议明确标为提交给执行边界的 command source string。
仅有 argv、`program + args`、SDK display summary 或若干片段时，source 必须是 opaque。

框架不 join argv，不重新 quote，不做 shell syntax parse，也不把多条 native operations 合并成一条命令。
Adapter 只有在原生协议提供独立 occurrence identity 时，才能产出多笔 logical occurrences。

`language` 只用于 provenance 与诊断。
TextRule 始终匹配 source 的原始 code units，不能根据 language 改写 candidate。

现有 `pickCommand(command/cmd/program+args)` 只能作为非权威显示摘要。
它不能进入 Assertion、Claim、command projector 或 coverage 判断。

## Logical occurrence

每笔 logical tool occurrence 包含：

```ts
interface LogicalToolOccurrence {
  readonly id: string;
  readonly session: string;
  readonly turn: string;
  readonly name: {
    readonly original: string;
    readonly canonical?: string;
  };
  readonly input: JsonValue;
  readonly command: CommandProjection;
  readonly start: EventPosition;
  readonly finish?: EventPosition;
  readonly status: "pending" | "completed" | "failed" | "rejected";
}
```

command 不是第二笔事件、第二个 identity 或摘要数组。
它是同一笔 tool occurrence 的标准投影，复用 id、start、finish 与 status。

orphan finish 没有可信 start、name、input 或 command classification。
它可以用于诊断协议缺口，不能凭空匹配 `ranCommand()` 或占据 `eventOrder()` 的 command 位置。

## Actions coverage

Adapter 只有同时满足以下条件，才能为一个 Turn 声明 `actions: complete`：

1. 原生协议中的全部 action occurrences 都进入标准事件流；
2. 每笔 tool occurrence 都有穷尽的 command / not-command 分类；
3. 原生协议明确提供的 tool input 全部保留；
4. 没有无法识别的 action kind、丢失的 started occurrence 或未交代的截断；
5. opaque command source 使用结构化 reason，而不是伪造空字符串。

command source 是 opaque 不必自动降低整个 actions channel。
它表示 occurrence 集合完整，但该字段无法判定；依赖 source 的 Assertion仍可能 unavailable。

Adapter 无法判断 command / not-command 时必须降低 actions coverage。
它不能因为 canonical name 是 `shell`，或 input 含 `command`、`cmd`、`program`、`args` 而宣称 complete。

## `ranCommand()` 真值

collector 先筛选 command occurrences，再让同一个 CommandRule 检查 source、status 与 count。

| 已观察证据 | actions coverage | 结果 |
|---|---|---|
| 至少一笔 definite match，且 count 已确定满足 | 任意 | passed |
| 所有 occurrence 都 definite mismatch，count 已确定不满足 | complete | failed |
| 没有 definite match，但有 command source opaque | 任意 | unavailable |
| 没有 definite match，可能仍缺 occurrence | partial / unavailable | unavailable |
| 完整集合可以确定 count 满足或不满足 | complete | 按 count 结果 |

需要总数上限、exact count 或 pending absence 时，partial actions 通常不能形成 passed。
只有已经观察到的下界足以证明某个 `{ min }` 时，正向 count 才可在 partial channel 上通过。

`ranCommand()` 不检查 OS exit semantics。
status 来自 Agent operation lifecycle；作者要求 `completed` 时，证明的是该 logical occurrence 以 completed finish 封口。

## `eventOrder()`

sequence matcher 在同一 session 中寻找 distinct occurrences：

```text
A.start ───── A.finish   B.start ─── B.finish   assistant
                    <       <                         <
```

每个非最终 operation 必须 closed。
相邻项要求 `next.start > previous.finish`；相等、交叠或并发都不能形成链。
最终 operation 可以 open，单点 message 的 start 与 finish 是同一个 event position。

算法按 event position 建立候选图：

1. 每个规则节点收集 definite 与 indeterminate candidates；
2. 边只连接 distinct occurrence，且满足严格非重叠；
3. 存在全 definite 完整路径时 passed；
4. 没有 definite 路径，但 opaque 或 partial evidence 仍允许路径时 unavailable；
5. required channels 完整，且不存在任何可行路径时 failed。

`{ command: rule }` 直接调用 `ranCommand()` 使用的单 occurrence evaluator。
EventRule 不复制 command parsing、TextRule、status 或 opaque 语义。

turn sequence 的 required channels 是各项并集。
`command` 需要 actions，assistant reply 需要 messages；任一缺口都参与 feasible path 判断。

## 工具输入负断言

`toolInputsExclude()` 只检查标准 tool occurrence 的 input，不检查 stdout、assistant reply、子进程变量集合或 OS syscall。
默认 selector 包含 scope 内所有 tools；显式 `tools` 同时按 canonical / original identifier exact 筛选。

JSON walker 只访问 string leaves：

- object 按 own enumerable string keys 的稳定顺序遍历 value；
- array 按 index 遍历；
- 不检查 key；
- 不调用 getter、`toJSON` 或 `String()`；
- number、boolean 与 null 不进入 TextRule。

| 证据 | 结果 |
|---|---|
| 任一 string leaf definite match | failed |
| actions complete、所选 inputs 全部可遍历、没有 match | passed |
| actions 不完整，且没有已知 match | unavailable |
| input 存在可能隐藏 string 的 opaque subtree，且没有已知 match | unavailable |

因此该 API 的承诺是“已观察工具输入里没有命中”。
它不会把这项结果写成“Agent 没有读取文件”或“OS 没有访问路径”。

## Change ledger

Sandbox provider 为 Attempt 输出一次最终 diff export。
core 用 send 前后的稳定边界把 entry 归因到 Turn，并应用 `EvalDefinition.diff.ignore`。

一条 Turn change 是边界两端的最终关系：

```ts
interface TurnChange {
  readonly path: SandboxPath;
  readonly kind: "added" | "modified" | "deleted";
  readonly before: TextEvidence | { readonly state: "absent" };
  readonly after: TextEvidence | { readonly state: "absent" };
}
```

同一路径在一个 Turn 的最终 ledger 中最多一条。
改后复原不会出现在 changed-path 集合；rename 固定表示 old path deleted 与 new path added。

`paths({ exact })` 对 added、modified、deleted 的 normalized path 做集合相等，不比较数组顺序。
expected 有重复项是 author error；actual 若违反唯一性是 provider/evaluator defect。

exact set 的三值规则是：

- 已观察到 expected 之外的确定 path，立即 failed；
- collector complete 时，集合相等 passed，不等 failed；
- collector partial 且尚无矛盾时 unavailable。

`noChanges()` 调用同一个 evaluator，并固定 expected 为空集。
它不是另一套“diff 文本为空”检查。

`fileChanged(path)` 只接受 added / modified。
删除必须使用 `fileDeleted(path)`；`paths({ exact })` 则把三种 kind 都计入集合。

## 延迟 source

EvidenceSource 是不可伪造的惰性 token。
创建 token 不做 I/O；`check()` finalize 或 awaited `require()` 到达求值边界时才读取候选值。

同一条 Assertion 中的 source 只读取一次。
读取、UTF-8 解码和 JSON parse 共享 Attempt cancellation signal，并服从同一 deadline。

### 文本文件

`sandbox.file(path)` 的 missing 与 invalid UTF-8 是 definite content failure，因此 Assertion failed。
permission、transport、timeout 与 terminated 表示无法取得 candidate，因此 unavailable。

TextRule 只在 available UTF-8 string 上调用一次。
missing 不会交给 `{ excludes }`，避免“文件不存在，所以不含禁止文本”假通过。

### JSON 文件

`sandbox.json(path)` 在求值边界执行：read bytes → strict UTF-8 decode → JSON parse → JsonRule。

missing、invalid UTF-8 与 JSON syntax error 都是 failed。
syntax detail 保留首个 line/column 与有界 parser message；不会把原始秘密内容完整复制进诊断。

permission、transport、timeout 与 terminated 是 unavailable。
parser throw、provider 返回非法 envelope 或 evaluator 非法状态是 defect，才使 Attempt errored。

Standard Schema validator throw、rejection 或非法 result 同样是 evaluator defect。
普通 schema issues 是 failed；schema transformed output 被丢弃，`require()` 返回原始 parsed value。

## Array relation

`array.exact` 直接比较 rule index 与 actual index，并要求长度相等。
`array.unordered` 构造二分图：左侧是 rule occurrence，右侧是 actual index，definite match 形成确定边。

unordered passed 需要匹配两侧全部节点的完美匹配。
因此它是 exact multiset，不是 subset contains：

- 重复 rule 要求不同 actual indices；
- 重复 actual value 仍是多个元素；
- 额外 actual element 会使长度或完美匹配失败；
- 同一 actual index 不能满足两个 rule occurrences。

若只有借助 indeterminate edge 才可能形成完美匹配，结果 unavailable。
完整 JSON 没有 opaque node 时，无法形成完美匹配就是 failed。

诊断先固定 rule path，再报告候选 actual indices 与最深 mismatch。
算法不能因为遍历顺序不同而随机选择另一条主诊断。

## `requireOne()` 控制边界

`requireOne()` 对 available collection 只检查 `length === 1`，并登记一条 Assertion。
passed 时返回原元素，因此 branded `SandboxPath`、discriminated union 或 readonly subtype 都得到保留。

0 或 2 项以上是 failed；source unavailable 是 unavailable。
两种非 passed 结果都通过内部 control signal 终止依赖路径，collector 把它识别为已登记 Assertion，不记 Attempt error。

label 与 points 都属于这一条 Assertion。
它固定 gate，不允许用 soft 绕过随后代码的数据依赖。

## Evaluator 边界

以下情况是 author error，并在登记边界同步报告：

- rule 同时出现互斥关系；
- 空 contains、非法 CountRule、重复 expected path；
- 非法 snapshot、schema envelope 或不足两项的 eventOrder；
- Pass/Fail Eval 向 `requireOne()` 传 points。

以下情况是 candidate failed：

- available value 与 rule 不匹配；
- source missing、invalid UTF-8 或 invalid JSON；
- exact-one collection 数量不等于 1。

以下情况是 unavailable：

- coverage 不足且事实仍可能成立；
- 标准字段 structured opaque；
- Sandbox permission、transport、timeout 或 terminated。

只有框架、Adapter、provider、parser 或自定义 evaluator 违反自身协议时，Attempt 才 errored。

## AssertionResult 与 Claim

每次调用登记一条结构化 Assertion：

```ts
interface AssertionResult {
  readonly name: string;
  readonly nameKind: "author" | "generated";
  readonly scope: AssertionScope;
  readonly outcome: "passed" | "failed" | "unavailable";
  readonly score?: number;
  readonly points?: number;
  readonly reason?: string;
  readonly detail?: AssertionDetail;
  readonly evidence: readonly EvidenceRef[];
}
```

receiver 决定 scope；`.label()` 或 require options 提供 author name；否则从一等方法与 rule 生成稳定标题。
标题不拼入 turn 前缀，show / view 根据结构化 scope 渲染归属。

Assertion Claim 引用实际消费的 Observation、diff export 或 Sandbox read evidence。
它不会把非权威 `pickCommand` 摘要、私有 `.niceeval` 文件或 Report projection 当成判断依据。

## 普通 API 防膨胀

一个事实进入普通词汇前必须同时满足 observation owner、两个真实下游、跨 Adapter completeness 和正交 rule domain。
不满足时进入高级 API 或用户代码。

普通 domain 不共享万能 `Rule` 联合，也不提供任意 `not/allOf/oneOf/predicate`。
局部 excludes、field absent 和 array relation 都绑定单一 candidate，不能组合成跨值逻辑程序。

这使 `ranCommand()`、`paths()` 与 `sandbox.json()` 成为稳定领域入口，而不是旧 Match AST 的别名层。
