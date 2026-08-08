# Assertion 作者面 —— Library

本页定义普通 Assertion 词汇、延迟 source、handle 与高级逃生口。
Rule 的值关系见 [Rule](matching.md)，证据与错误分类见 [Architecture](architecture.md)。

## 已登记 handle

普通 Assertion 调用立即登记一条 pending Assertion，并返回 handle：

```ts
interface AssertionHandle {
  label(name: string): AssertionHandle;
  gate(threshold?: number): AssertionHandle;
  atLeast(threshold: number): AssertionHandle;
  soft(): AssertionHandle;
  optional(): AssertionHandle;
  stopOnFailure(): Promise<void>;
}

interface ScoreAssertionHandle {
  label(name: string): ScoreAssertionHandle;
  points(n: number): ScorePointHandle;
  gate(threshold?: number): ScoreAssertionHandle;
  atLeast(threshold: number): ScoreAssertionHandle;
  soft(): ScoreAssertionHandle;
  optional(): ScoreAssertionHandle;
  stopOnFailure(): Promise<void>;
}

interface ScorePointHandle {
  label(name: string): ScorePointHandle;
  gate(threshold?: number): ScorePointHandle;
  optional(): ScorePointHandle;
  stopOnFailure(): Promise<void>;
}
```

modifier 配置同一条 pending Assertion，并返回同一逻辑 handle。
求值开始时 handle 冻结；之后通过任何 alias 调 modifier 都同步报告 author error。

`.stopOnFailure()` 必须 `await`。
passed 时 Promise fulfill；failed 或 unavailable 写入 Assertion 后终止依赖路径；evaluator defect 才进入 Attempt error。

## `t.check()` 与延迟 source

普通值与框架 source 共用 `t.check()`，但 source 由私有品牌与普通值分流：

```ts
declare const evidenceSourceBrand: unique symbol;
declare const sandboxPathBrand: unique symbol;

type SandboxPath = string & {
  readonly [sandboxPathBrand]: "sandbox-path";
};

interface EvidenceSource<T> {
  readonly [evidenceSourceBrand]: T;
}

type ImmediateValue<T> = T & {
  readonly [evidenceSourceBrand]?: never;
};

interface PassFailTestContext {
  check(value: ImmediateValue<string>, rule: TextRule): AssertionHandle;
  check(value: ImmediateValue<JsonValue>, rule: JsonRule): AssertionHandle;
  check(source: EvidenceSource<string>, rule: TextRule): AssertionHandle;
  check(source: EvidenceSource<JsonValue>, rule: JsonRule): AssertionHandle;
}

interface ScoreTestContext {
  check(value: ImmediateValue<string>, rule: TextRule): ScoreAssertionHandle;
  check(value: ImmediateValue<JsonValue>, rule: JsonRule): ScoreAssertionHandle;
  check(source: EvidenceSource<string>, rule: TextRule): ScoreAssertionHandle;
  check(source: EvidenceSource<JsonValue>, rule: JsonRule): ScoreAssertionHandle;
}
```

实际 declaration 另含 generic exact、Standard Schema 与高级 ValueAssertion overload。
JavaScript 入口也先识别 source 品牌，不能把 token 当成 candidate 交给 rule。

```ts
t.check(t.sandbox.file("experiments/local.ts"), {
  contains: "runtime:python",
  excludes: { contains: "runtime:node" },
}).points(2).gate();
```

## `t.require()`

`t.require()` 把一条 Assertion 同时作为计分项、gate 和 control boundary：

```ts
interface RequireOptions {
  readonly label?: string;
}

interface RequireScoreOptions extends RequireOptions {
  readonly points?: number;
}

type RequiredJsonValue<R extends JsonRule> =
  R extends { readonly exact: infer E extends JsonValue }
    ? E
    : R extends { readonly shape: infer P extends JsonShapeSpec }
      ? InferShape<P>
      : JsonValue;

interface PassFailTestContext {
  require<V extends string>(
    value: ImmediateValue<V> | EvidenceSource<V>,
    rule: TextRule,
    options?: RequireOptions,
  ): Promise<V>;
  require<V extends JsonValue, R extends JsonRule>(
    value: ImmediateValue<V> | EvidenceSource<V>,
    rule: R,
    options?: RequireOptions,
  ): Promise<V & RequiredJsonValue<R>>;
}

interface ScoreTestContext {
  require<V extends string>(
    value: ImmediateValue<V> | EvidenceSource<V>,
    rule: TextRule,
    options?: RequireScoreOptions,
  ): Promise<V>;
  require<V extends JsonValue, R extends JsonRule>(
    value: ImmediateValue<V> | EvidenceSource<V>,
    rule: R,
    options?: RequireScoreOptions,
  ): Promise<V & RequiredJsonValue<R>>;
}
```

passed 时返回原值与 rule 证明的静态子集交集。
failed 与 unavailable 都不返回，而是使用框架 control signal 终止依赖路径；它们不会制造 Attempt errored。

JsonRule 的 schema 分支只验证原始 parsed JSON。
它不采用 schema transformed output，因此 `require(source, { schema })` 返回 `JsonValue`，不根据 schema output 收窄。

## `t.requireOne()`

exact-one 是常见的数据依赖边界，不要求作者写 type predicate：

```ts
interface RequireOneOptions {
  readonly label?: string;
}

interface RequireOneScoreOptions extends RequireOneOptions {
  readonly points?: number;
}

interface PassFailTestContext {
  requireOne<T>(
    values: readonly T[] | EvidenceSource<readonly T[]>,
    options?: RequireOneOptions,
  ): Promise<T>;
}

interface ScoreTestContext {
  requireOne<T>(
    values: readonly T[] | EvidenceSource<readonly T[]>,
    options?: RequireOneScoreOptions,
  ): Promise<T>;
}
```

`requireOne()` 只登记一条 gate Assertion。
available 集合长度为 1 时 passed 并返回唯一的 `T`；其它长度 failed；source unavailable 时 unavailable。

failed 与 unavailable 都终止依赖路径，不产生第二条控制 Assertion，也不使 Attempt errored。
Score Eval 的 points 必须是正有限数；Pass/Fail Eval 的静态类型和 JavaScript runtime 都拒绝 points。

## Scoped Assertions

turn、session 与 `t` 共享稳定行为事实；receiver 决定范围：

```ts
interface ScopedAssertions<H> {
  succeeded(): H;
  parked(): H;
  messageIncludes(token: string): H;
  ranCommand(rule: CommandRule): H;
  toolInputsExclude(rule: TextRule, options?: ToolInputOptions): H;
  loadedSkill(skill: string): H;
  calledSubagent(name: string, rule?: SubagentRule): H;
  noFailedActions(): H;
  eventOrder(sequence: readonly [EventRule, EventRule, ...EventRule[]]): H;
  maxTokens(max: number): H;
  maxCost(usd: number): H;
}

interface ToolInputOptions {
  readonly tools?: readonly string[];
}

interface SubagentRule {
  readonly status?: "pending" | "completed" | "failed";
  readonly remoteUrl?: TextRule;
  readonly output?: JsonRule;
  readonly count?: CountRule;
}
```

`ranCommand()` 匹配标准 command projection，不接收 tool name。
rule 的 source、status 与 count 约束同一批 logical occurrences。

`toolInputsExclude()` 默认检查 scope 内所有 tool occurrences 的 input 字符串 leaves。
它不 stringify JSON、不检查 key、不把 number 或 boolean 转成字符串。

`tools` 过滤器显式缩小时，identifier 先匹配 canonical name，再匹配 original name，两者都使用 exact。
一个 occurrence 任一名字命中即进入检查集合；过滤器不是 command 分类依据。

## `eventOrder()`

```ts
turn.eventOrder([
  { command: { pattern: /niceeval\s+exp\s+local/i } },
  { command: { pattern: /niceeval\s+show/i, status: "completed" } },
  { reply: "assistant" },
]);
```

`{ command: rule }` 与 `ranCommand(rule)` 使用同一标准 command occurrence 和 TextRule evaluator。
顺序项没有 count；每个位置必须由不同 occurrence 满足。

非最终 operation 必须已经 finish，且下一项满足 `next.start > previous.finish`。
最终项可以是 open operation；message 等单点 occurrence 的 start 与 finish 使用同一个 event position。

turn 只看本轮；session 可以跨自己的 Turns；`t` 要求某一条 session 内存在完整链。
attempt receiver 不能把并发 sessions 的半链拼成一条结果。

## Turn changes

Sandbox-backed Turn 暴露该 `send` 区间对应的最终 workspace delta：

```ts
interface ChangeSelection {
  readonly kind?: "added" | "modified" | "deleted";
  readonly path?: TextRule;
}

interface ExactPathSetRule {
  readonly exact: readonly string[];
}

interface TurnChanges<H> {
  fileChanged(path: string): H;
  fileDeleted(path: string): H;
  hasChange(rule: ChangeRule): H;
  noChange(rule: ChangeRule): H;
  noChanges(): H;
  paths(rule: ExactPathSetRule): H;
  files(selection?: ChangeSelection): EvidenceSource<readonly SandboxPath[]>;
}
```

```ts
turn.changes.paths({ exact: ["experiments/local.ts"] }).gate();
```

`paths({ exact })` 比较应用 `EvalDefinition.diff.ignore` 后、归因到该 Turn 的最终 changed-path 集合。
added、modified 与 deleted 全部计入；同一路径只出现一次。

路径先按 Sandbox 的 normalized relative path 规则归一。
expected 中的重复项同步报告 author error；数组顺序没有语义，诊断按 normalized path 排序。

`noChanges()` 与 `paths({ exact: [] })` 使用同一个集合 collector 和 coverage 判定。
`fileChanged()` 仍只匹配 added 或 modified；`fileDeleted()` 只匹配 deleted。

`files()` 是类型化 selection source，不登记 Assertion。
它返回最终 delta 中满足 selection 的唯一 normalized paths，按诊断稳定顺序排列，供 `requireOne()` 消费。

`defineEval()` 保持 Agent-agnostic，同一份 Eval 可以由 Direct 或 Sandbox Agent 运行。
因此 `TestContext` 继续使用包含 `t.sandbox` 与 `turn.changes` 的宽接口，不按运行期 Agent kind 改变静态成员。

Direct Agent 运行时登记 Sandbox 或 change consumer，会同步报告 `sandbox-capability-required` author error。
本 Roadmap 不引入 capability-generic `defineEval()`，也不让 TypeScript 对同一份 Eval 按 Experiment 配置切换形状。

## 延迟 Sandbox 文件

```ts
interface EvalSandbox {
  file(path: string | SandboxPath): EvidenceSource<string>;
  json(path: string | SandboxPath): EvidenceSource<JsonValue>;
}
```

`file()` 表示延迟文本文件，不增加语义重复的 `text()`。
它在 consumer 求值边界读取一次，并把同一次求值中的结果 memoize。

| File resolution | Outcome |
|---|---|
| available UTF-8 text | 按 TextRule 求值 |
| missing | failed，reason=`sandbox-file-missing` |
| invalid UTF-8 | failed，reason=`sandbox-file-invalid-utf8` |
| permission / transport / timeout / terminated | unavailable，reason=`sandbox-file-unavailable` |
| provider 违反读取协议 | Attempt errored |

missing 与非法 UTF-8 是已取得的确定内容状态，不会伪装成 `undefined`、空字符串或 transport failure。

## 延迟 Sandbox JSON

`json()` 在 consumer 边界读取 UTF-8 文本并调用一次 `JSON.parse`：

```ts
t.check(t.sandbox.json("/tmp/history.json"), {
  shape: { summary: { shape: { passed: 3, failed: 1, errored: 0 } } },
});
```

| JSON resolution | Outcome |
|---|---|
| valid JSON | 按 JsonRule 求值 |
| missing | failed，reason=`sandbox-json-missing` |
| invalid UTF-8 | failed，reason=`sandbox-json-invalid-utf8` |
| JSON syntax error | failed，reason=`sandbox-json-invalid-syntax`，包含首个 line/column |
| permission / transport / timeout / terminated | unavailable，reason=`sandbox-json-unavailable` |
| parser 或 provider 违反内部协议 | Attempt errored |

同一个 source token 在一条 Assertion 中只读取一次、解码一次并调用一次 `JSON.parse`。
它不会暴露 raw sentinel，也不允许 rule 自己重新 parse 字符串。

## JSON object 与 array node

JsonRule 的 shape 使用显式 node，避免 object field 与 array relation 混成递归 union：

```ts
type JsonPrimitive = null | boolean | number | string;

type JsonNodeRule =
  | JsonPrimitive
  | TextRule
  | { readonly type: "string" | "number" | "boolean" | "object" | "array" | "null" }
  | { readonly exact: JsonValue }
  | { readonly shape: JsonShapeSpec }
  | { readonly array: JsonArrayRule };

type JsonFieldRule =
  | JsonNodeRule
  | { readonly present: true }
  | { readonly absent: true };

interface JsonShapeSpec {
  readonly [key: string]: JsonFieldRule;
}

type JsonArrayRule =
  | {
      readonly exact: readonly JsonNodeRule[];
      readonly unordered?: never;
      readonly items?: never;
      readonly length?: never;
    }
  | {
      readonly unordered: readonly JsonNodeRule[];
      readonly exact?: never;
      readonly items?: never;
      readonly length?: never;
    }
  | {
      readonly items: JsonNodeRule;
      readonly length?: CountRule;
      readonly exact?: never;
      readonly unordered?: never;
    };

type PresentJsonKeys<P extends JsonShapeSpec> = {
  [K in keyof P]-?: P[K] extends { readonly absent: true } ? never : K;
}[keyof P];

type AbsentJsonKeys<P extends JsonShapeSpec> = {
  [K in keyof P]-?: P[K] extends { readonly absent: true } ? K : never;
}[keyof P];

type JsonValueOfType<T> =
  T extends "string" ? string
  : T extends "number" ? number
  : T extends "boolean" ? boolean
  : T extends "object" ? { readonly [key: string]: JsonValue }
  : T extends "array" ? readonly JsonValue[]
  : T extends "null" ? null
  : JsonValue;

type InferJsonNode<R> =
  R extends { readonly exact: infer E extends JsonValue }
    ? E
    : R extends TextRule
      ? string
      : R extends JsonPrimitive
        ? R
        : R extends { readonly type: infer T }
          ? JsonValueOfType<T>
          : R extends { readonly present: true }
            ? JsonValue
            : R extends { readonly shape: infer P extends JsonShapeSpec }
              ? InferShape<P>
              : R extends { readonly array: unknown }
                ? readonly JsonValue[]
                : JsonValue;

type InferShape<P extends JsonShapeSpec> = {
  readonly [K in PresentJsonKeys<P>]: InferJsonNode<P[K]>;
} & {
  readonly [K in AbsentJsonKeys<P>]?: never;
};
```

plain primitive 在 shape slot 中表示 exact。
TextRule 只接受实际 string；`present` / `absent` 只允许出现在 object field slot。

`array.exact` 是有序、等长、逐位置匹配。
`array.unordered` 是 exact multiset：rule 与 actual element 必须存在一一完美匹配，所有元素都被消费，不允许额外元素。

重复 rule 需要不同 actual elements 满足；两个相等 actual elements也按不同 index 参与匹配。
一个 actual element 不能同时满足两个 rule；存在多个可行配对时，任一完美匹配即可通过。

`array.items` 要求每个 actual element 匹配同一 rule；`length` 省略时不限制长度。
length number 表示 exact，range 使用 `CountRule`；empty array 也按这些规则正常求值。

失败诊断优先报告：类型、长度、无法形成完美匹配的首个 rule path、再到该 rule 内的最深 mismatch path。
unordered 诊断使用 rule index，不伪造 actual 顺序。

## 高级入口

普通 API 只接受 inline rule。
`niceeval/expect/advanced` 承担 Match AST、任意具名 predicate、adapter-specific tool 检查和 custom evaluator。

```ts
turn.advanced.calledTool("domain.search", {
  input: advancedMatch.json.shape({ query: advancedMatch.text.contains("refund") }),
});
```

高级 tool inspection 明确绑定 Adapter 或应用工具名，不会被描述成 canonical command fact。
普通 Harness 不使用该入口，也不把高级 Match 值嵌回 EventRule 或 JsonRule。

## Judge 交接

Judge handle 使用 required `name` 作为唯一作者标题，不再暴露第二个 label 入口。
结构化材料继续由原生 LLM Judge Runtime 的 `material.json()` / `material.text()` 提供。

机器可确定的命令、顺序、路径集合、文件内容和 JSON 结构由本页词汇检查。
Judge 只评价解释质量、归因是否合理与开放式 rubric，不重复机器事实。
