# Assertion 作者面 —— Library

本页只定义相对既有 Assertions 与 Sandbox API 的目标扩展。
值关系见 [Rule](matching.md)，证据与三态求值见 [Architecture](architecture.md)。

## Assertion handle

普通 Assertion 调用立即登记一条 pending Assertion，并返回既有 handle。
本 Roadmap 不增加另一种 modifier 或结果类型。

```ts
interface BaseAssertionHandle<H> {
  label(name: string): H;
  gate(threshold?: number): H;
  atLeast(threshold: number): H;
  soft(): H;
  optional(): H;
  stopOnFailure(): Promise<H>;
}

interface AssertionHandle extends BaseAssertionHandle<AssertionHandle> {}

interface ScoreAssertionHandle extends BaseAssertionHandle<ScoreAssertionHandle> {
  points(n: number): ScorePointHandle;
}

interface ScorePointHandle {
  gate(threshold?: number): ScorePointHandle;
  optional(): ScorePointHandle;
  stopOnFailure(): Promise<ScorePointHandle>;
}
```

Score Assertion 直接链 `.gate()` 表示零分硬要求。
只有 `.points(n)` 登记可得分值，且 `n` 必须是正有限数；`.points(0).gate()` 是 author error。

`.stopOnFailure()` 必须 `await`。
passed 时 Promise fulfill；failed 或 unavailable 写入 Assertion 后终止依赖路径；evaluator defect 才进入 Attempt error。

## 延迟文本文件

`t.sandbox.file(path)` 继续表示延迟文本材料，不增加 `text(path)` 或 `json(path)`：

```ts
declare const evidenceSourceBrand: unique symbol;

interface EvidenceSource<T> {
  readonly [evidenceSourceBrand]: T;
}

interface EvalSandbox<H> {
  file(path: string): EvidenceSource<string>;
}

interface TestContext<H> {
  check(value: string | EvidenceSource<string>, rule: TextRule): H;
}
```

品牌 symbol 由 declaration 私有持有，普通作者不能伪造 source。
source 在 Assertion 求值边界读取一次，同一条 Assertion 中 memoize。

普通调用直接写 inline rule：

```ts
t.check(t.sandbox.file("experiments/local.ts"), { contains: "runtime:python", excludes: { contains: "runtime:node" } }).points(2).gate();
```

| File resolution | Outcome |
|---|---|
| available UTF-8 text | 按 `TextRule` 求值 |
| missing | failed，reason=`sandbox-file-missing` |
| invalid UTF-8 | failed，reason=`sandbox-file-invalid-utf8` |
| permission / transport / timeout / terminated | unavailable，reason=`sandbox-file-unavailable` |
| provider 违反读取协议 | Attempt errored |

missing 不会被当作空字符串交给 `excludes`，所以“文件不存在”不能假通过“不含禁止文本”。

## 工具与 command selector

`calledTool()` 与 `toolOrder()` 继续是 `t`、session、turn 共用的作用域词汇。
它们扩展为接受同一个 `ToolSelector`：

```ts
type CommandSelector = {
  readonly command: readonly [executable: string, ...argsPrefix: string[]];
  readonly excludes?: readonly string[];
};

type ToolSelector = string | CommandSelector;

interface ToolOrderOptions {
  readonly sequential?: boolean;
}

interface ScopedAssertions<H> {
  succeeded(): H;
  calledTool(selector: ToolSelector, match?: ToolMatch): H;
  toolOrder(
    selectors: readonly [ToolSelector, ToolSelector, ...ToolSelector[]],
    options?: ToolOrderOptions,
  ): H;
  toolInputsExclude(rule: ToolInputExclusion, options?: ToolInputOptions): H;
}
```

string selector 保持既有语义：按 canonical tool name、再按 original tool name 做 exact identifier 匹配。
command selector 不接收 tool name；它只消费 Adapter 提供的标准 command projection。

`command` 数组的第一项是 exact executable，后续项是 argv prefix。
`excludes` 中每项按 exact argv token 排除；它不搜索拼接后的 shell 文本。

```ts
turn.calledTool({ command: ["niceeval", "show"] }).gate();
turn.toolOrder([{ command: ["niceeval", "exp", "local"], excludes: ["--dry", "--dry-run"] }, { command: ["niceeval", "show"] }], { sequential: true }).gate();
```

`calledTool()` 默认要求匹配 occurrence 的 status 为 `completed`，与既有 ToolMatch 默认一致。
`toolOrder()` 省略 `sequential` 时保持既有 request subsequence 语义，允许其它工具穿插。

`sequential: true` 时，每个 selector 必须由不同的 completed occurrence 满足。
相邻两项还要求后一项的 start 严格晚于前一项的 finish；无关 occurrence 仍可穿插。

## 可观察工具输入排除

Eve 的 matcher 可以用 RegExp 或 predicate 搜索 input，但 Harness 的普通作者不应维护路径边界正则。
NiceEval 因此只增加路径这一项中立负断言：

```ts
interface ToolInputExclusion {
  readonly paths: readonly [string, ...string[]];
}

interface ToolInputOptions {
  readonly tools?: readonly string[];
}

turn.toolInputsExclude({ paths: [".niceeval", "evals", "agents"] }).gate();
```

默认检查 scope 内所有 tool occurrences 的 input string leaves。
`tools` 显式缩小时按 canonical / original tool identifier exact 过滤；它不参与 command 分类。

每个 `paths` 项按完整路径 component 匹配，接受 `/` 与 `\\` 分隔符。
它不会把 `agentship`、`my.evals-cache` 或普通句子中的相邻字母当作目标 component。

该方法只承诺 observed-input exclusion。
它不检查 stdout、assistant reply、子进程变量集合、文件描述符或 OS syscall。

## Sandbox change assertions

agent 归因 diff 已属于 `t.sandbox`。
精确路径、空范围和同 entry 内容条件继续扩展这个 receiver：

```ts
interface FileChangeOptions {
  readonly beforeIncludes?: string;
  readonly afterIncludes?: string;
}

interface EvalSandbox<H> {
  changedPaths(paths: readonly string[]): H;
  noChanges(): H;
  fileChanged(path: string, options?: FileChangeOptions): H;
  fileDeleted(path: string): H;
  file(path: string): EvidenceSource<string>;
}
```

```ts
t.sandbox.changedPaths(["experiments/local.ts"]).points(3).gate();
t.sandbox.fileChanged("experiments/local.ts", { beforeIncludes: "runtime:node", afterIncludes: "runtime:python" }).points(2).gate();
t.sandbox.noChanges().points(2).gate();
```

`changedPaths()` 比较应用 `EvalDefinition.diff.ignore` 后的 agent 归因 path set。
added、modified、deleted 与净改回原样但确实被 agent 触及的 path 都进入集合；数组顺序没有语义。

expected path 先按 Sandbox workdir-relative 规则归一；重复项是 author error。
`noChanges()` 与 `changedPaths([])` 使用同一个 collector，但公开保留更直接的空集名字。

`fileChanged()` 保持既有“agent 触及过该文件”语义。
传入内容条件时，`beforeIncludes` 与 `afterIncludes` 必须由同一条 agent change entry 满足；它不从不同 send 区间拼接证据。

内容条件只证明字符串存在，不声称文件只改了该 token，也不做字节级 patch equality。
对应内容是 binary、oversized 或 provider 无法提供时，结果是 unavailable。

## Judge 交接

完整 Turn 的开放式诊断直接使用 LLM Judge Runtime 已有作用域接收者：

```ts
turn.judge.llm({
  name: "诊断结论",
  rubric: "结合本轮完整工具调用、工具输出和最终回复，判断归因与修复建议是否正确。",
  scoreMode: "binary",
}).points(4).gate();
```

`turn.judge.llm()` 的默认 current material 包含该轮用户输入、assistant message 与可用行为事件。
作者不需要 `material.turn(turn)`，也不应只传 `turn.message` 丢掉 tool calls。

机器可确定的 command 顺序、工具输入与 Sandbox diff 不重复交给 Judge。
CLI Human 输出中的 locator 关联、诊断含义和建议质量由完整 Turn Judge 判断。

## 普通路径边界

本 Roadmap 不导出 `match.text.*`、`match.json.*` 或新的 Match AST。
新方法只接受本页的 inline selector / rule，不接受外部 matcher 值。

已有 `niceeval/expect` 仍服务于任意立即值和已有 `t.check()` 场景；它不是作用域或 Sandbox 领域事实的依赖。
Harness 不通过 predicate、JSON parser 或自定义 Assertion 绕开本页边界。
