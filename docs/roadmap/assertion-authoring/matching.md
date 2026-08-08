# Assertion 作者面 —— Rule

普通作者只在调用点写领域参数。
这些对象不是可构造、保存或组合的通用 Match AST。

## TextRule

文本文件与其它明确 string value 使用单层 inline rule：

```ts
type TextAtom =
  | { readonly exact: string; readonly contains?: never }
  | { readonly contains: string; readonly exact?: never };

type TextRule = TextAtom & {
  readonly excludes?: TextAtom | readonly [TextAtom, ...TextAtom[]];
};
```

普通路径不接受直接传入的 RegExp，也不提供 `pattern`。
Harness 的规则若只能靠一段复杂正则才读得懂，应先寻找结构化领域事实；自由文本确实需要模糊判断时使用 Judge。

`exact` 使用 code-unit equality。
`contains` 使用大小写敏感的 literal substring，并拒绝空字符串。

`excludes` 只约束满足主 atom 的同一个 candidate：

```ts
t.check(t.sandbox.file("experiments/local.ts"), { contains: "runtime:python", excludes: { contains: "runtime:node" } });
```

框架不 trim、不做 Unicode normalization、不调用 `String(value)`，也不序列化其它值后搜索。
identifier slot 继续接受未包装的非空 string，并固定 exact；工具名、executable、argv token 与 Sandbox path 都是 identifier。

## ToolMatch command 字段

command 是既有 `ToolMatch` 的内联窄字段：

```ts
interface CommandMatch {
  readonly executable: string;
  readonly argsStart?: readonly string[];
  readonly excludes?: readonly string[];
}
```

匹配一笔 occurrence 时同时满足：

1. 标准 logical projection 可用；
2. logical executable 与 `command.executable` exact；
3. logical argv 以 `command.argsStart` 逐 token exact 开头；
4. logical argv 不含任一 `excludes` exact token。

空 executable、空 expected token 或重复 `excludes` 是 author error。
command 字段不对 raw shell text 做语法 parse，不做 basename 猜测，不跨 token 搜索 substring，也不暴露 original / wrapper selector。

Observation Protocol 在 Assertion 之前把已证明透明的 direct、`pnpm exec`、`pnpm --silent exec` 与无选项 `npx` 投影成同一套 logical executable / argv。
runner 自己的 `--silent` 不进入 logical argv，目标命令边界后的 token 原样保留。
logical 只表示请求的 CLI，不证明 package provenance、版本或物理 binary。

`input`、`output`、`status` 与 `command` 匹配同一笔 occurrence。
`calledTool()` 与 `toolOrder()` 调用同一个单 occurrence evaluator，因此不会出现两套 command 语义。

`ToolSelector` 只给这份 matcher 补上 tool name，并删除 count：

```ts
type ToolSelector = { readonly name: string } & Omit<ToolMatch, "count">;
```

`toolOrder()` 的每一项消费一个不同 actual index。
它按 request position 做子序列匹配，不把 status 或 command 字段解释成 finish-before-start 因果关系。
单 occurrence 字段求值中 definite mismatch 压过 indeterminate；order 同时检查 definite 与 possible 两种子序列，opaque candidate 不能被粗略当成已调用或未调用。

## Tool input path exclusion

```ts
interface ToolInputExclusion {
  readonly paths: readonly [string, ...string[]];
}
```

path 先按 `/` 与 `\\` 切成非空 components，再对工具 input 的每个 string leaf 做连续 component 匹配。
相对路径、绝对路径和 Windows separator 使用同一规则。

输入字符串中的目标前后必须是路径边界。
字母、数字、`_`、`.` 与 `-` 的相邻文本不会被误当作 component 边界。

这项关系只用于 `toolInputsExclude()`。
它不是通用 string matcher，也不能嵌进 `calledTool().input`。

## Sandbox change 条件

```ts
interface FileChangeOptions {
  readonly beforeIncludes?: string;
  readonly afterIncludes?: string;
}
```

两个字段都是大小写敏感的 literal substring，并拒绝空字符串。
它们和 path、change kind 共同匹配一条 agent change entry。

added 没有 before，deleted 没有 after。
作者对缺失一侧写内容条件时是确定 mismatch；内容被 elide 或读取证据不完整时是 unavailable。

`changedPaths(paths)` 是 exact set relation，不是 ordered array relation：

- expected 顺序不影响结果；
- expected 重复 path 是 author error；
- actual 的额外或缺失 path 都 failed；
- partial diff 尚不能排除缺失 path 时 unavailable。

## 不提供通用 JSON rule

本作者面不增加 `JsonRule`、递归 `shape`、数组 `exact/unordered`、field presence 或 schema wrapper。
它们会把普通 Harness 变成 JSON 查询语言，并把某个 CLI 的展示 envelope 固化成核心 API。

任意应用值已有 `t.check()` 与 `niceeval/expect`。
Standard Schema 继续适合业务结构；`niceeval show` 的诊断语义则由完整 Turn Judge 检查，不由 Eval 自行 parse 或匹配 JSON。

## TypeScript 消歧

领域对象使用封闭字段并依赖 excess-property checking：

- `ToolSelector.name` 只能表示 exact tool identifier；
- `ToolMatch.command` 只能接受 `CommandMatch`；
- `{ exact }` 与 `{ contains }` 是互斥的 `TextAtom`；
- `TextRule`、`CommandMatch` 与 `ToolInputExclusion` 互不赋值。

JavaScript、`any` 或扩散对象绕过静态检查时，登记边界执行同一套穷尽 runtime validation。
互斥字段、空值或未知字段同步报告 author error，不登记一条永远匹配不到的 Assertion。
