# Assertion 作者面 —— Rule

普通作者在调用点写单层 rule object。
Rule 是各领域 API 的参数，不是作者需要构造、保存或组合的通用 AST。

## TextRule

```ts
type TextAtom =
  | {
      readonly exact: string;
      readonly contains?: never;
      readonly pattern?: never;
    }
  | {
      readonly contains: string;
      readonly exact?: never;
      readonly pattern?: never;
    }
  | {
      readonly pattern: RegExp;
      readonly exact?: never;
      readonly contains?: never;
    };

type TextRule = TextAtom & {
  readonly excludes?: TextAtom | readonly [TextAtom, ...TextAtom[]];
};
```

`exact` 使用 code-unit equality。
`contains` 使用大小写敏感的 literal substring，并拒绝空字符串。
`pattern` 保存 `source` 与 `flags`，每次求值创建新的 RegExp，不能受 `lastIndex` 污染。

框架不 trim、不做 Unicode normalization、不调用 `String(value)`，也不序列化 JSON 后搜索。
大小写、空白和 shell quoting 都由作者的 literal 或 RegExp 明确表达。

`excludes` 只约束已经满足主 atom 的同一个 candidate：

```ts
turn.ranCommand({
  pattern: /niceeval\s+exp\s+local/i,
  excludes: { pattern: /--dry(?:-run)?\b/i },
});
```

这条规则要求同一条 command source 命中主 pattern，且不命中排除项。
它不会拿一条命令满足主 pattern，再拿另一条命令满足 excludes。

Text slot 不接受直接传入的 string 或 RegExp。
关系必须在值里写出，避免同一个字符串在不同接收位置分别代表 exact 或 contains。

Identifier slot 继续接受直接传入的非空 string，并固定 exact。
工具名、角色、Skill 名、request id 与 change kind 都是 identifier；自由文本、command source 和 diff 内容不是。

## CommandRule

```ts
type CountRule =
  | number
  | { readonly min: number; readonly max?: number }
  | { readonly min?: number; readonly max: number };

interface CommandOccurrenceFilter {
  readonly status?: "pending" | "completed" | "failed" | "rejected";
  readonly count?: CountRule;
}

type CommandRule = TextRule & CommandOccurrenceFilter;
type OrderedCommandRule = TextRule & Omit<CommandOccurrenceFilter, "count">;
```

TextRule、status 与 count 必须由同一批 command occurrences 满足。
省略 count 表示 `{ min: 1 }`；number 表示 exact count。
`ranCommand()` 的“ran”只承诺 occurrence 已开始，不隐含成功；要求成功时写 `status: "completed"`。

CommandRule 只匹配 Observation 协议提供的原始 command source。
它不从 input 字段猜命令，也不把 argv、program 和 args 重建成文本。

## EventRule

```ts
type MessageEventRule =
  | { readonly reply: "assistant"; readonly text?: TextRule }
  | {
      readonly message: "user";
      readonly origin?: "eval" | "agent";
      readonly text?: TextRule;
    };

type EventRule =
  | { readonly command: OrderedCommandRule }
  | MessageEventRule
  | { readonly skill: string }
  | { readonly error: TextRule };
```

实际 declaration 用互斥字段封闭各分支；JavaScript 或 `any` 不能同时传 `command` 与 `reply`。
`{ command: rule }` 与 `ranCommand(rule)` 使用同一个 command selector 和 TextRule evaluator，不建立第二套命令语义。

EventRule 不接受 count。
顺序中的每一项由一笔 occurrence 满足，同一 occurrence 不能占两个位置。

## JsonRule

```ts
type JsonRule =
  | {
      readonly exact: SnapshotCompatible<JsonValue>;
      readonly shape?: never;
      readonly schema?: never;
    }
  | {
      readonly shape: JsonShapeSpec;
      readonly exact?: never;
      readonly schema?: never;
    }
  | {
      readonly schema: StandardSchemaV1;
      readonly exact?: never;
      readonly shape?: never;
    };
```

`exact` 比较完整 JSON-compatible snapshot。
`shape` 是 object 的 partial shape：plain scalar 表示 exact，plain object 递归表示 shape，array 要求长度和位置相等。
`schema` 调用一次 Standard Schema validator。

snapshot walker 不调用 getter 或 `toJSON`，拒绝 Proxy、cycle、accessor、class instance、`undefined`、NaN、Infinity、bigint、symbol 与 sparse array。
非法 expected 或 schema envelope 在 Assertion 登记边界同步报告 author error。

schema 的 transformed output 不会静默替换 `JSON.parse` 从 Sandbox 文件得到的值：

- `t.check(source, { schema })` 只做 validation；
- `t.require(source, { schema })` 通过后返回原始 parsed `JsonValue`，不采用 schema output，也不承诺类型收窄；
- 需要 transformed output 的作者显式调用独立 parse API，不能借 Assertion 隐式改值。

`exact` 与 `shape` 的 `t.require` overload 可以分别返回 expected subtype 与 `InferShape<P>` 的交集，因为它们验证的就是原始 JSON value。

## ChangeRule

```ts
interface ChangeRule {
  readonly path?: TextRule;
  readonly kind?: "added" | "modified" | "deleted";
  readonly before?: TextRule;
  readonly after?: TextRule;
}
```

ChangeRule 至少包含一个字段，所有字段匹配同一条 `{ window, path, kind, before, after }` entry。
路径 convenience `fileChanged(path)` 与 `fileDeleted(path)` 直接接收 string，并固定 normalized path exact。

## 三值求值

每个 rule 对一笔 candidate 得到 definite match、definite mismatch 或 indeterminate。
opaque source、opaque diff text 与不完整 selector 输入产生 indeterminate，不会被压成 mismatch。

集合断言再结合 coverage：

- 已有 definite match 的正断言可以 passed；
- 完整集合全部 definite mismatch 才 failed；
- 仍有 indeterminate candidate 或集合不完整时 unavailable。

负断言反向要求完整集合：任一 definite match 即 failed；只有集合完整且每项 definite mismatch 才 passed；其余情况 unavailable。

## 高级 Match 边界

`niceeval/expect/advanced` 可以提供不可变 Match AST、`allOf`、`oneOf`、`not`、具名 predicate 与 adapter-specific tool inspection。
高级入口用于框架没有标准事实的领域检查，不是普通断言的实现细节泄漏到调用点。

普通 API 不接受高级 Match 值，避免一个 overload 同时承担 inline rule 与 AST。
从高级 API 回到普通 API 必须先形成明确的自定义 Assertion，不能把 AST 作为 `CommandRule`、`JsonRule` 或 EventRule 字段传入。

新增普通词汇必须同时满足：

1. NiceEval 拥有该事实的 observation 或 source；
2. 至少两个独立真实下游需要它；
3. 不同 Adapter 可以遵守同一 completeness 与 unavailable 语义；
4. 新规则与 Text、Command、JSON、Event 等现有 domain 正交；
5. 调用点不需要通用组合器才能表达常见检查。

因此普通作者面是一组有边界的一等词汇，不是旧 Match AST 的语法糖，也不会以“再加一个组合器”的方式长成万能 DSL。
