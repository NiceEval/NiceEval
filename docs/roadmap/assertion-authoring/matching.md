# Assertion 作者面 —— Match

本页定义值条件与 selector 条件共用的 Match 语言。
它取代 raw `RegExp`、递归 `JsonMatch` union 和隐式 predicate，不保留旧签名或兼容别名。

## 一个关系只对应一种写法

```ts
import { conformsTo, defineAssertion, match, similarity } from "niceeval/expect";
```

公开 Match 分成三个 domain：

```ts
interface Match<in out T, out M = T> {
  /** 只替换当前 Match root 的诊断描述。 */
  describe(text: string): Match<T, M>;
  gate(threshold?: number): ValueAssertion<T>;
  atLeast(threshold: number): ValueAssertion<T>;
  soft(): ValueAssertion<T>;
  optional(): ValueAssertion<T>;
}

interface RefinementMatch<in out T, out S extends T>
  extends Match<T, S> {
  describe(text: string): RefinementMatch<T, S>;
  gate(threshold?: number): RefinementAssertion<T, S>;
  atLeast(threshold: number): RefinementAssertion<T, S>;
  soft(): RefinementAssertion<T, S>;
  optional(): RefinementAssertion<T, S>;
}

type TextMatch<M = string> = Match<string, M>;
type JsonMatch<M = unknown> = Match<JsonValue, M>;
```

`T` 是运行时 candidate domain，并在类型层保持 invariant。
`M` 只描述可能命中的静态子集，供组合器和明显不相交的调用做检查；普通 Match 通过时，`t.require` 不据此收窄。
只有 `RefinementMatch<T, S>` 承诺通过后得到 `S`。

Match 是不可变 AST。
builder、`.describe()` 与 severity modifier 都返回新值，原值可以在多条 Assertion 中复用。
框架用模块私有 registry 检验 AST；JavaScript 或 `any` 不能靠复制属性伪造 Match。

Match 直接登记时固定产生binary score：matched为1，mismatched为0，indeterminate映射unavailable；默认是threshold 1的gate。
severity modifier可以在登记前改变这一次复用值的阈值、soft或optional配置，但不会让它变成selector可接受的Match。

### Builder

| Builder | Domain | 关系 |
|---|---|---|
| `match.exact(value)` | `unknown` | 普通 TypeScript 值与 descriptor-safe snapshot 完整相等 |
| `match.text.exact(text)` | `string` | 文本严格相等 |
| `match.text.contains(text)` | `string` | 大小写敏感的 literal substring |
| `match.text.pattern(description, regexp)` | `string` | fresh RegExp 测试实际字符串 |
| `match.json.exact(value)` | `JsonValue` | JSON-compatible snapshot 完整相等 |
| `match.json.shape(spec)` | `JsonValue` | object 的显式 partial shape |
| `match.where(description, predicate)` | predicate 参数 | 有名的同步 boolean 或 type predicate |
| `match.defined<T>()` | `T` | 排除 `null | undefined` 并收窄 |
| `match.commandSucceeded()` | `CommandResult` | exit code 为 0，并给出命令诊断 |
| `match.not(inner)` | inner domain | 同一 domain 内取反 |
| `match.allOf([a, b, ...])` | 相同 domain | 同一 candidate 同时满足每一项 |
| `match.oneOf([a, b, ...])` | 相同 domain | 同一 candidate 至少满足一项 |

关键签名是：

```ts
interface MatchFactory {
  exact<const E>(expected: E & SnapshotCompatible<E>): Match<unknown, E>;

  readonly text: {
    exact<const S extends string>(expected: S): TextMatch<S>;
    contains(needle: string): TextMatch;
    pattern(description: string, pattern: RegExp): TextMatch;
  };

  readonly json: {
    exact<const E>(expected: E & SnapshotCompatible<E>): JsonMatch<SnapshotOf<E>>;
    shape<const P extends JsonShapeSpec>(spec: P): JsonMatch<InferShape<P>>;
  };

  where<T, S extends T>(
    description: string,
    predicate: (value: T) => value is S,
  ): RefinementMatch<T, S>;
  where<T>(description: string, predicate: (value: T) => boolean): Match<T, T>;
  defined<T>(): RefinementMatch<T, NonNullable<T>>;
  commandSucceeded(): Match<CommandResult, CommandResult>;

  not<T, M>(inner: Match<T, M>): Match<T, T>;
  allOf<T>(items: readonly [Match<T, unknown>, Match<T, unknown>, ...Match<T, unknown>[]]): Match<T, unknown>;
  oneOf<T>(items: readonly [Match<T, unknown>, Match<T, unknown>, ...Match<T, unknown>[]]): Match<T, unknown>;
}
```

实际 declaration snapshot让allOf的`M`成为各item possible-set intersection，让oneOf成为union；上面省略只影响示意长度，不改变domain invariance。
`t.check/t.require` 用保守的`CouldOverlap<Value,M>`拒绝编译器能证明完全不相交的调用。
object比较只在共同key类型确定冲突时拒绝；optional key、没有共同key、unknown/any或达到类型递归上限都保守接受，runtime validator仍是最终边界。

`not`、`allOf` 与 `oneOf` 返回普通 Match，不传播 refinement。
需要组合后的类型收窄时，作者写一条有描述的 type predicate；框架不推导 complement、intersection 或 union refinement。
`allOf` 与 `oneOf` 类型上至少两项，JavaScript 调用也执行相同 guard。

```ts
const localWithoutForce = match.allOf([
  match.text.pattern(
    "niceeval exp local command",
    /\bniceeval\s+exp\s+local\b/i,
  ),
  match.not(match.text.contains("--force")),
]).describe("非强制的完整 local 命令");

turn.calledTool("shell", {
  input: match.json.shape({ command: localWithoutForce }),
});
```

两项在同一个 `command` 字符串上求值。
把它们拆成两条 `calledTool` 会允许两笔不同调用分别命中，不能替代 `allOf`。

## Text domain

Text builder 不接收 options，也不改写输入。
exact 使用 code-unit equality；contains 使用 `String.prototype.includes`，并拒绝空 needle；pattern 保存 `source` 与 `flags`，每次用 fresh RegExp 测试完整字符串。
框架不执行 `String(value)`、trim、大小写折叠、Unicode normalization、换行改写、JSON serialization 或 comment stripping。

自由文本与开放筛选字段只接收 `TextMatch`：

- message、thinking、context、compaction 与 error 文本；
- input request 的 prompt 与 display；
- subagent remote URL；
- change path、before 与 after。

因此 `event({ type: "message", text: "done" })` 是 author error；exact 必须写成 `text: match.text.exact("done")`。
工具名、subagent 名、Skill 名、request id 与 action 是明确 identifier，继续接收 nonblank string 并固定 exact。
公开 API 中没有 `string | Match<string>` 双义 union。

方法名已经给出关系时，只保留单一 literal convenience：

- `messageIncludes(token: string)` 固定 contains；
- `fileChanged(path: string)` 与 `fileDeleted(path: string)` 固定 normalized path exact；
- `toolOrder(names)` 的名字固定 exact。

## JSON domain

`match.json.shape` 的 outer object 明确表示 partial shape。
spec 内 plain scalar 是 exact，plain object 递归使用 shape，array 要求长度与位置都相等；TextMatch 与 JsonMatch node 可以成为叶。
raw RegExp、raw function 与 top-level serialized JSON search 不存在。

```ts
const command = match.text.pattern("niceeval show command", /\bniceeval\s+show\b/i);
const input = match.json.shape({ command });
```

shape snapshot 固定 ECMAScript own string-key order：array-index key 数值升序，其余 key 按 builder 调用时的插入顺序。
求值、short-circuit 与 main diagnostic path 使用同一顺序。
exact 不含 predicate child，object key 改用 canonical key order，使相同值不因 property insertion 不同而改变诊断。

generic exact、JSON exact 与 shape 都使用 descriptor-safe walker。
合法 snapshot 包含 `null`、boolean、string、有限 number、dense array，以及 prototype 为 `Object.prototype | null`、只含 own enumerable string-keyed data property 的 plain object。
walker 不调用 getter、`toJSON`，不沿 prototype 取值，并在遍历前拒绝 Proxy。

builder 的 expected value 含 `undefined`、hole、NaN、Infinity、bigint、symbol、accessor、额外 array property、cycle 或 class instance时，同步产生 author error。
普通 TypeScript interface 不需要 string index signature：

```ts
interface Config {
  mode: "strict";
  retries: number;
}

t.check(actualConfig, match.exact(expectedConfig));
```

complete actual 不属于 snapshot-compatible set 时是 definite mismatch，并显示首个 unsupported path。
它不是 unavailable，也不会为比较而调用 getter。
JsonMatch 收到非 JsonValue 时，作者直接传值属于 author error；framework-owned tool input 违反 JsonValue 协议则是 Adapter defect。

## Predicate 与 refinement

```ts
const oneFile = match.where(
  "恰好一个文件",
  (files: readonly string[]): files is readonly [string] => files.length === 1,
);

const [path] = await t.require(files, oneFile);

const value = await t.require(
  maybeValue,
  match.defined<string | undefined>(),
);
// value: string
```

type predicate overload 返回 `RefinementMatch<T, S>`；普通 boolean overload 返回 `Match<T, T>`。
predicate 必须同步返回严格 boolean。
thenable、truthy object、number、string、`undefined` 或 throw 都是 evaluator defect；`.optional()` 不遮蔽 defect。

generic predicate 的 `T` 在 JavaScript runtime 已擦除。
框架不会伪造一个 domain validator：函数返回 false 是 mismatch，throw 是 evaluator defect。
需要 runtime 可验证 domain 时，使用 text、JSON 或 CommandResult built-in family。

## Description 与 Assertion label

Match node 保存 `{ text, origin }` description。
exact、contains、defined、commandSucceeded 与组合器的自动摘要是 `generated`；pattern、where 的必填 description 与 `.describe(text)` 是 `author`。
`.describe()` 只替换当前 root，children description 保留。

Match 与 ValueAssertion 没有 `.label()`。
`.label()` 只配置已经登记的 AssertionHandle；没有 handle 的 `t.require` 使用 `{ label? }` registration option。

```ts
const input = match.json.shape({
  command: match.text.pattern("local command", /niceeval exp local/),
  cwd: match.where("workspace cwd", (value: JsonValue) => value === "."),
}).describe("valid shell input");
```

嵌进 `calledTool` 时，scope Assertion 的生成标题仍是 `calledTool(shell)`；失败诊断依次保留 `input — valid shell input`、`input.command — local command` 或 `input.cwd — workspace cwd`。
scope handle 的 `.label()` 只替换 Assertion title，不改这些 node descriptions。

同一个 root 直接传给 `t.check` 时，root description 成为默认 name，并继承自己的 `generated | author` origin 到 `nameKind`。
显式 handle label 或 require label 始终写 `nameKind: "author"`，root description 继续留在 detail。

## 三值 Match evaluation

作者只构造 Match；内部 engine 使用：

```ts
type MatchEvaluation =
  | { readonly state: "matched" }
  | { readonly state: "mismatched"; readonly diagnostic: MatchDiagnostic }
  | { readonly state: "indeterminate"; readonly diagnostic: MatchDiagnostic };
```

普通值以 complete evidence 进入 engine。
provider truncation、redaction 与未采字段必须是结构化 opaque node，不能伪装成占位字符串、`undefined` 或空串。
Record 写盘预算发生在 runtime evaluation 之后，不反向改变当次结果。

组合使用确定的三值逻辑：

- `not` 交换 matched / mismatched，indeterminate 保持不变；
- `allOf` 与 shape 遇首个 mismatch 立即停止；全部 matched 才 matched，否则 indeterminate；
- `oneOf` 遇首个 matched 立即停止；全部 mismatch 才 mismatch，否则 indeterminate。

allOf / oneOf 按 array source order，shape 按 snapshot key order。
indeterminate 不是 short-circuit：后项仍可能给出决定性的 mismatch 或 match。
engine 不为补充诊断调用已经无需执行的 predicate。

同一 Assertion 内，collector 按 Match node identity 与 candidate ref memoize。
order DP 或 count aggregation 重访同一 candidate 时不重跑 predicate；同一 Match 被两条 Assertion 复用时，每条各自求值。

scope collector 把 candidate 分成 definite-match、definite-mismatch 与 possible-match。
count、absence 与 order 的统一折叠见 [Architecture · Match evidence](architecture.md#match-evidence)。

## 有界诊断

Match tree 是 core 内部 IR，不进入 public API 或 Record。
AssertionResult 继续只保存 `expected`、`received` 与 `evidence` 文本。

shape 使用 snapshot key order；exact 使用 canonical key order；allOf / oneOf 使用 arm source order。
main failure 取首个 decisive node。
oneOf 全部失败时按 source order 列各 alternative；not 因 inner matched 而失败时保存 inner 的 positive witness。
opaque path 与 reason 也按同一稳定顺序投影。

中央 projector 统一移除控制字节，并把 expected、received、evidence 各自限制在 4096 UTF-8 bytes。
截断停在 Unicode scalar boundary，marker 包含原始 byte count并计入同一上限。
Match、Schema、Judge、scope 与 Sandbox 不自设第二套 preview 限制。

## Schema 与异步 evaluator 不属于 Match

Standard Schema 验证改名为 `conformsTo(schema)`。
它可能异步或 transform，因此返回普通 ValueAssertion，不能嵌进 selector，也不产生 refinement。

```ts
function conformsTo<S extends StandardSchemaV1>(
  schema: S,
): ValueAssertion<StandardSchemaV1.InferInput<S>>;

const raw = await t.require(input, conformsTo(schema));
// raw 仍是原始 input；schema 的 transformed output 被丢弃。
```

合法 issues 是 mismatch。
非法 Standard Schema envelope 在 builder 调用时报 author error；validate throw/rejection 或非法 result 是 evaluator defect。
需要 parsed output 时，作者直接调用 schema；本主题不引入 parse-and-assert API。

`similarity` 与 `defineAssertion` 同样继续返回 ValueAssertion。
异步或连续评分不会成为 scoped selector node。

## Breaking surface

本主题不提供 deprecation layer：

| 删除的入口 | 唯一新写法 |
|---|---|
| `equals(value)` | `match.exact`、`match.text.exact` 或 `match.json.exact` |
| `includes(text)` | `match.text.contains(text)` |
| `excludes(text)` | `match.not(match.text.contains(text))` |
| `matches(schema)` | `conformsTo(schema)` |
| `satisfies(predicate)` | `match.where(description, predicate)` |
| `isDefined()` | `match.defined()` |
| `isTrue()` / `isFalse()` | domain 对应的 exact |
| `commandSucceeded()` | `match.commandSucceeded()` |
| raw `JsonMatch` object / RegExp / function | `match.json.shape/exact` 与有名 Match node |
| `string | RegExp | predicate` text slot | 只接收 `TextMatch` |

`stripComments` 不进入新 API。
忽略注释需要作者先做明确的语言转换，或用有 description 的 predicate；通用文本 matcher 不猜编程语言。
