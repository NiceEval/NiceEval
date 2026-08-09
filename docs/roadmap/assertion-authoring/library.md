# Assertion 作者面 —— Library

本页只定义相对既有 Assertions 与 Sandbox API 的目标扩展。
值关系见 [Rule](matching.md)，证据与三态求值见 [Architecture](architecture.md)。

## Assertion handle

普通 Assertion 调用立即登记一条 pending Assertion，并返回既有 handle。
本 Roadmap 不增加另一种 modifier 或结果类型。

```ts
interface BaseAssertionHandle<H> {
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

## ToolMatch 内的 command

`calledTool()` 与 `toolOrder()` 继续是 `t`、session、turn 共用的作用域词汇。
command 作为既有 `ToolMatch` 的一个窄字段进入同一笔 tool occurrence：

```ts
interface CommandMatch {
  readonly executable: string;
  readonly argsStart?: readonly string[];
  readonly excludes?: readonly string[];
}

interface ToolMatch {
  readonly input?: JsonMatch;
  readonly output?: JsonMatch;
  readonly status?: "pending" | "completed" | "failed" | "rejected";
  readonly count?: number | ((count: number) => boolean);
  readonly command?: CommandMatch;
}

type ToolSelector = { readonly name: string } & Omit<ToolMatch, "count">;

interface ScopedAssertions<H> {
  succeeded(): H;
  calledTool(name: string, match?: ToolMatch): H;
  toolOrder(names: readonly [string, string, ...string[]]): H;
  toolOrder(selectors: readonly [ToolSelector, ToolSelector, ...ToolSelector[]]): H;
  toolInputsExclude(rule: ToolInputExclusion, options?: ToolInputOptions): H;
}
```

`name` 保持既有 exact tool identifier 语义。
`command` 与 input、output、status 必须由同一笔 occurrence 满足；`count` 统计同时满足全部字段的 occurrences。

`executable` 按 logical exact identifier 匹配，`argsStart` 按 logical argv token prefix 匹配。
`excludes` 中每项按 logical argv 的 exact token 排除；它不搜索拼接后的 shell 文本，也不看 runner 自己的 flags。

```ts
turn.calledTool("shell", { command: { executable: "niceeval", argsStart: ["show"] } }).gate();
turn.toolOrder([{ name: "shell", command: { executable: "niceeval", argsStart: ["exp", "local"], excludes: ["--dry", "--dry-run"] } }, { name: "shell", command: { executable: "niceeval", argsStart: ["show"] }, status: "completed" }]).gate();
```

同一条 `executable: "niceeval"` 能匹配 direct `niceeval`、`pnpm exec niceeval`、`pnpm --silent exec niceeval` 与无 runner-option 的 `npx niceeval`。
这是 Observation Protocol 已经证明的 logical command request；它不声称定位到某个包版本或物理 binary。
original tokens 只进入脱敏、受预算约束的审计与诊断，不进入普通作者签名。

`calledTool()` 默认要求匹配 occurrence 的 status 为 `completed`，与既有 ToolMatch 默认一致。
`toolOrder()` 的 selector 省略 status 时不增加 lifecycle 条件；显式 `status: "completed"` 才要求该 occurrence 已完成。

`toolOrder()` 保持既有 request subsequence 语义。
它用单调 cursor 为每项消费一笔不同 occurrence，允许其它工具穿插；它不证明前一项 finish 早于后一项 start。
既有 string tuple overload 保留，并在登记边界逐项等价为 `{ name }`；需要 command、input、output 或 status 时才使用 `ToolSelector` overload，两者复用同一个 occurrence evaluator。

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

## 普通路径边界

本 Roadmap 不导出 `match.text.*`、`match.json.*` 或新的 Match AST。
新方法只接受本页的 inline selector / rule，不接受外部 matcher 值。

已有 `niceeval/expect` 仍服务于任意立即值和已有 `t.check()` 场景；它不是作用域或 Sandbox 领域事实的依赖。
Harness 不通过 predicate、JSON parser 或自定义 Assertion 绕开本页边界。
