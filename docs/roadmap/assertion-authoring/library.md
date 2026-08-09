# Assertion 作者面 —— Library

## 值与延迟 source

```ts
interface TestContext<H> {
  check<T, R extends T>(subject: T | EvidenceSource<T>, match: ValueMatch<T, R>): H;
  require<T, R extends T>(value: T, match: BooleanMatch<T, R, "value">): Promise<R>;
}

interface EvalSandbox<H> {
  file(path: string): EvidenceSource<string>;
}
```

`t.check()` 只负责“subject × matcher”并登记 Assertion。布尔 matcher 在通过制默认 gate；连续评分 matcher 默认 soft 且没有隐含阈值，作者在 handle 上明确写 `.atLeast(x)` 或 `.gate(x)`。

`t.require()` 只接受布尔 matcher，等价于 `await t.check(value, matcher).gate().stopOnFailure()` 并在通过后返回原值。延迟 source 不进入 `require()`，避免返回一个看似已收窄、实际仍未读取的引用。

```ts
t.check(t.reply, and(includes("Brooklyn"), excludes("draft")));
t.check(t.reply, or(includes("sunny"), includes("clear")));
t.check(t.reply, similarity(expected)).atLeast(0.6);
t.check(t.sandbox.file("experiments/local.ts"), and(includes("runtime:python"), excludes("runtime:node"))).points(2).gate();
```

File source 在每条 Assertion 内只读取一次，组合子 matcher 共用同一个 string candidate：

| File resolution | Outcome |
|---|---|
| available UTF-8 text | 运行 matcher |
| missing / invalid UTF-8 | failed |
| permission / transport / timeout / terminated | unavailable，reason=`sandbox-file-unavailable` |
| provider 返回非法 envelope | Attempt errored |

missing 不会变成空字符串，因此 `excludes()` 不能让不存在的文件假通过。

## Assertion handle

matcher 不带登记策略；策略只在 `t.check()` 或领域断言返回的 handle：

```ts
interface BaseAssertionHandle<H> {
  gate(threshold?: number): H;
  atLeast(threshold: number): H;
  soft(): H;
  optional(): H;
  stopOnFailure(): Promise<H>;
}
```

Score Assertion 直接链 `.gate()` 是零分硬要求。只有 `.points(n)` 进入可得分总数，且 `n` 必须是正有限数；`.points(0).gate()` 是 author error。

## Tool 与 event match

```ts
interface CollectionMatch {
  readonly count?: number;
}

interface ScopedAssertions<H> {
  calledTool(match: ToolMatch, options?: CollectionMatch): H;
  notCalledTool(match: ToolMatch): H;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): H;

  event(match: EventMatch, options?: CollectionMatch): H;
  notEvent(match: EventMatch): H;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): H;
}
```

presence、absence、count 与 order 复用同一个单 occurrence match。`count` 留在集合断言第二参数；不接受直接传入的 selector 对象或 string shorthand。

```ts
turn.calledTool(commandMatch("niceeval", { argsStart: ["show"], status: "completed" })).gate();
turn.calledTool(toolMatch("shell", { status: "failed" }), { count: 1 }).gate();
turn.toolOrder([
  commandMatch("niceeval", { argsStart: ["exp", "local"], excludes: ["--dry", "--dry-run"] }),
  commandMatch("niceeval", { argsStart: ["show"], status: "completed" }),
]).gate();
turn.event(eventMatch("message", { role: "assistant", text: includes("done") })).gate();
turn.notCalledTool(toolMatch({ input: referencesAnyPath([".niceeval", "evals", "agents"]) })).gate();
```

`commandMatch()` 与 `toolMatch()` 都匹配同一个 logical tool occurrence。普通命令断言只写前者；只有确实还要约束 Adapter 工具分类时，才写 `and(commandMatch(...), toolMatch(...))`。组合的两个分支在同一笔 occurrence 上求值，不会分别寻找两笔工具调用。

负存在性仍接收同一个 `ToolMatch`：

```ts
t.notCalledTool(or(toolMatch("read_file"), toolMatch("file_read"))).gate();
t.notCalledTool(and(toolMatch("shell"), commandMatch("cat"))).gate();
```

禁止“任一候选工具”用 `or()`；要求同一笔 occurrence 同时满足多个条件才用 `and()`。

## Sandbox 领域断言

文件材料与 agent 归因 diff 都属于 `t.sandbox`：

```ts
interface EvalSandbox<H> {
  changedPaths(paths: readonly string[]): H;
  noChanges(): H;
  fileChanged(path: string, options?: {
    before?: BooleanMatch<string, string, "value">;
    after?: BooleanMatch<string, string, "value">;
  }): H;
  fileDeleted(path: string): H;
  file(path: string): EvidenceSource<string>;
}
```

`changedPaths()` 比较应用 `EvalDefinition.diff.ignore` 后的 exact path set；顺序无意义，重复 expected path 是 author error，added、modified、deleted 与净改回但确实触及的 path 都计入。`noChanges()` 与空集合使用同一个 collector。

`fileChanged(path, options)` 的 `before` / `after` matcher 必须由同一条 change entry 满足。普通文本关系继续复用 `includes()` / `excludes()`，不增加 `beforeIncludes` 一类关系别名。该断言不声称字节级只改了一个 token。

工具输入的负约束不增加 Sandbox 或 scoped 专用方法。`referencesAnyPath()` 匹配输入中的可观察路径引用，`toolMatch({ input })` 把它提升为任意工具 occurrence 的条件，`notCalledTool()` 提供负存在性量词。证据不完整且没有已知命中时是 unavailable；这项组合不冒充 OS 审计。

## 普通路径边界

`niceeval/expect` 只导出独立工厂：值关系使用 `includes()` / `equals()`，领域 occurrence 使用 `toolMatch()` / `eventMatch()` / `commandMatch()`，组合统一使用 `and()` / `or()`。不同时提供 `match.*`、fluent 同义入口或递归 JSON AST；Sandbox 事实仍从 `t.sandbox` 进入。
