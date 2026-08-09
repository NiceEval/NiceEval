# Assertion 作者面 —— Match 与组合

## 值 matcher

`t.check()` 的第二参数是纯比较器，不携带 severity、threshold、optional 或 points：

```ts
type MatchDomain = "value" | "tool" | "event";
declare const matchBrand: unique symbol;

interface Match<in T, out R, D extends MatchDomain> {
  readonly domain: D;
  readonly name: string;
  readonly [matchBrand]: (candidate: T) => R;
}

interface BooleanMatch<in T, out R extends T, D extends MatchDomain = "value"> extends Match<T, R, D> {
  readonly kind: "boolean";
}

interface ScoreMatch<in T> extends Match<T, T, "value"> {
  readonly kind: "score";
}

type ValueMatch<T, R extends T = T> = BooleanMatch<T, R, "value"> | ScoreMatch<T>;
type ToolMatch<R extends LogicalToolOccurrence = LogicalToolOccurrence> = BooleanMatch<LogicalToolOccurrence, R, "tool">;
type EventMatch<R extends MatchableEvent = MatchableEvent> = BooleanMatch<MatchableEvent, R, "event">;
```

`matchBrand` 由 declaration 私有持有，不导出，也不公开任意 `evaluate()` 入口。普通作者只能使用具名工厂，不能手写 selector object 或匿名 evaluator。matcher 成功后的 `R` 必须是原 candidate 的收窄类型，不是转换后的新值；`matches(schema)` 只验证 Standard Schema，schema transform 不偷偷改变 Match 输出。

内部候选求值结果固定为 `matched | mismatched | unavailable`。`matched` 携带同一个 candidate 的 refinement；另外两种携带非空诊断，`unavailable` 还携带 coverage reason。它不使用 `passed | failed`，因为一笔 occurrence mismatch 不等于集合 Assertion failed。

`includes()` / `excludes()` 只接收 string，不把任意值 `String()` 后搜索。`equals()` 是深相等，`matches()` 消费 Standard Schema。identifier slot 继续使用直接传入的 string exact；工具名、事件类型、executable、argv token 与 Sandbox path 都属于 identifier。

```ts
t.check(t.reply, includes("Brooklyn"));
t.check(t.sandbox.file("experiments/local.ts"), and(includes("runtime:python"), excludes("runtime:node")));
t.check(turn.data, matches(ResultSchema));
```

关系由 matcher 名字决定，不由接收位置猜：没有未包装 string＝contains、直接 RegExp＝pattern，也没有 `{ contains, excludes }` 这一套旁路 rule。

## `and()` 与 `or()`

两者至少接收两个同 domain 的 `BooleanMatch<T, R, D>`；`similarity()` 等连续 `ScoreMatch` 在类型层不能进入组合。

```ts
type TupleIntersection<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail] ? Head & TupleIntersection<Tail> : unknown;

declare function and<T, D extends MatchDomain, const R extends readonly [T, T, ...T[]]>(...matches: { [K in keyof R]: BooleanMatch<T, R[K], D> }): BooleanMatch<T, TupleIntersection<R>, D>;
declare function or<T, D extends MatchDomain, const R extends readonly [T, T, ...T[]]>(...matches: { [K in keyof R]: BooleanMatch<T, R[K], D> }): BooleanMatch<T, R[number], D>;
```

求值规则：

- `and()`：任一 failed → failed；否则任一 unavailable → unavailable；否则 passed；
- `or()`：任一 passed → passed；否则任一 unavailable → unavailable；否则 failed；
- 两者按声明顺序 await 全部子项，输出每个未通过子项的诊断；
- 子 matcher 抛错不是 failed 或 unavailable，而是 evaluator defect；
- source resolution 在组合之外先执行一次，因此 `or()` 不能用另一分支掩盖文件读取失败。

JavaScript / `any` 的登记边界仍校验至少两项、同 domain 和布尔种类。诊断按组合树和子项索引保留，经现有脱敏与预算规则写入 `AssertionResult.expected`、`received` 与 `evidence`；内部 evaluator defect 不能被另一个决定性分支掩盖。

不增加 `not()`。文本否定已有 `excludes()`；其它否定关系等真实重复需求出现后再命名。

## 单 occurrence `ToolMatch`

```ts
type ToolStatus = "pending" | "completed" | "failed" | "rejected";
type LogicalCommandOccurrence = LogicalToolOccurrence & {
  readonly command: Extract<CommandProjection, { readonly kind: "command" }>;
};

declare function commandMatch(executable: string, options?: {
  argsStart?: readonly string[];
  excludes?: readonly string[];
  status?: ToolStatus;
}): ToolMatch<LogicalCommandOccurrence>;

declare function toolMatch(name: string, options?: {
  input?: BooleanMatch<JsonValue, JsonValue, "value">;
  status?: ToolStatus;
}): ToolMatch;

interface ScopedAssertions<H> {
  calledTool(match: ToolMatch, options?: { count?: number }): H;
  notCalledTool(match: ToolMatch): H;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): H;
}
```

`toolMatch()` 与 `commandMatch()` 都返回 domain=`tool` 的 `BooleanMatch`。command 没有独立 identity，因此不占一个 Match domain，也不再嵌进 `toolMatch()`。省略 `status` 表示“不限制 lifecycle”；需要 completed 必须显式写。直接传 `{ name, status }` 与 string shorthand 都不是公共入口。

`name`、`input`、logical command 与 `status` 都在同一笔 occurrence 上求值。需要同时约束 command 与 Adapter 工具分类时，使用 `and(commandMatch(...), toolMatch(...))`；两个 matcher 不会各自搜索 occurrence。字段 definite mismatch 压过 unavailable。当前不公开 `output`，因为缺失 output 还没有 `absent | opaque` 的证据状态，不能诚实地区分“确定没有”与“没观察到”。次数不属于 matcher：

```ts
turn.calledTool(toolMatch("shell", { status: "completed" }), { count: 1 }).gate();
turn.notCalledTool(toolMatch("shell", { input: matches(ForbiddenInputSchema) })).gate();
turn.calledTool(and(commandMatch("niceeval", { argsStart: ["show"] }), toolMatch("shell", { status: "completed" }))).gate();
```

`notCalledTool(match)` 的逻辑是“scope 内不存在满足 match 的 occurrence”。因此：

- 禁止 A 或 B 任一工具出现，写 `notCalledTool(or(toolMatch("A"), toolMatch("B")))`；
- 只禁止同一笔 occurrence 同时满足 A 与 B，写 `notCalledTool(and(A, B))`；
- `notCalledTool(and(A, B))` 不会禁止只满足 A 或只满足 B 的 occurrence。

`toolOrder()` 用单调 cursor 消费不同 occurrence，只证明 request subsequence；它不证明前一项 finish-before-start，也不建立因果关系。

`calledTool(..., { count })` 是 exact count，必须是正 safe integer；零次使用 `notCalledTool()`。tool count 按 distinct occurrence identity，`toolOrder()` 按 occurrence start position 匹配有序子序列，每项消费不同 occurrence。partial / opaque 证据继续分别计算 definite path 与 possible path，不能把缺证据折成 failed。

## `commandMatch()`

`command` 只读取 durable logical projection：

1. logical executable 与第一个参数 exact；
2. logical argv 以 `argsStart` 逐 token exact 开头；
3. logical argv 不含任一 `excludes` exact token。

Adapter 先证明 original argv，Observation Protocol 再统一处理 direct、exact `pnpm exec`、`pnpm --silent exec` 与无 runner-option 的 exact `npx`。core 不按工具名、input key 或 raw shell text猜 command；opaque logical command 产生 unavailable。

`commandMatch()` 只保留 `executable`、`argsStart`、`excludes` 与共用 lifecycle `status`。cwd、env、raw text、wrapper、stdout、RegExp 与 predicate 不进入它；新增透明 wrapper 只能升级封闭 normalizer profile，不能开放 Eval 侧 registry。

`status` 不属于 command projection，而是 `toolMatch()` 与 `commandMatch()` 共用的 lifecycle evidence。
只有可信 `TurnOutcome.waiting` 下仍未解决的 operation，或原生协议明确给出的 pending，才能 definite match `pending`。
partial stream 中只有 start、没有可信 finish 时，status 是 unavailable，不能冒充 pending。

## `eventMatch()`

`eventMatch()` 返回 domain=`event` 的 `BooleanMatch`，并按 event type 使用封闭 options 映射。普通 message 字段复用文本 matcher；tool start/finish 必须关联 logical occurrence 后复用同一个 `ToolMatch`，event 自己不复制 name/input/command/status：

```ts
interface EventOptionsByType {
  readonly message: { readonly role?: "assistant" | "user"; readonly text?: BooleanMatch<string, string, "value"> };
  readonly "operation.started": { readonly tool?: ToolMatch };
  readonly "operation.finished": { readonly tool?: ToolMatch };
}

declare function eventMatch<K extends keyof EventOptionsByType>(
  type: K,
  options?: EventOptionsByType[K],
): EventMatch<Extract<MatchableEvent, { readonly type: K }>>;

turn.event(eventMatch("message", { role: "assistant", text: includes("done") })).gate();
turn.eventOrder([eventMatch("operation.finished", { tool: toolMatch("send_email", { status: "rejected" }) }), eventMatch("message", { role: "assistant", text: includes("not sent") })]).gate();
```

关联器按流位置把 started 与 finished 配成一笔唯一 occurrence。
`operationId` 只是允许完成后复用的配对 token，不能作为全局 identity。

- `event()` 的 exact count 是正 safe integer；零次使用 `notEvent()`；
- event count 按 distinct event identity；
- `eventOrder()` 按 `EventPosition` 消费不同事件；
- 同一 tool occurrence 的 start 与 finish 是两个 event。

`toolOrder()` 只证明 request subsequence。
只有显式排列 finish 与下一笔 start，才证明 finish-before-start。

## 不提供通用 JSON rule

本作者面不增加 `JsonRule`、`shape`、数组 `exact/unordered`、field presence 或匿名 predicate。应用已经拿到的结构值用 `equals()` 或 `matches(schema)`；`niceeval show` 的业务诊断不通过匹配某个公开 JSON envelope来冒充语义判断。
