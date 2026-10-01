# Assertions —— scoped methods

本页是 `calledTool`、`notCalledTool`、`usedNoTools`、`ToolMatch` 与计数的唯一公开契约。其它页面只链接本页，不重复签名、字段或计数规则。

每一次调用都通过同一 `check` 登记 Boolean Assertion。receiver 在调用处取得 snapshot；随后发生的 Session 或 Turn 不能改写这条 entry。Boolean handle 仍可 `await .orStop()`，它只等待并控制同一条已登记 Assertion。

## 调用形状

```ts
calledTool(match: ToolMatch | ToolOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
calledTool(name: string): BooleanAssertionHandle<Kind, void>;
notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
usedNoTools(): BooleanAssertionHandle<Kind, void>;
```

根 `t`、Session 与 Turn 使用相同签名。`calledTool` 与 `notCalledTool` 只接一个 Match 或工具名；`usedNoTools()` 完全零参数，也不接额外 Match。
`name` 是 `toolMatch(name)` 的薄糖，只按原始工具名选择 occurrence。`input`、`output` 与 `status` 都属于 `ToolMatch`。

普通 ToolMatch 表达至少一次匹配。次数通过 `ToolMatch.exactly(n)`、`.atLeast(n)` 或 `.greaterThan(n)` 构造 ToolOccurrenceMatch。
所有 `n` 都必须是安全整数；`calledTool` 的 `.exactly(n)` 与 `.atLeast(n)` 要求 `n > 0`，`.greaterThan(n)` 允许 `n >= 0`。
`calledTool` 只接受正存在或正 occurrence，拒绝 `.exactly(0)`、`.atLeast(0)` 与上界 `.atMost(n)`、`.lessThan(n)`。

证明没有匹配调用用 `notCalledTool(match)`；证明整个工具集合为 exact zero 用 `usedNoTools()`，未知集合不能证明没有发生。

```ts
import {
  commandMatch,
  jsonMatch,
  referencesAnyPath,
  toolMatch,
} from "niceeval/expect";

const turn = await t.send("查询台北天气，检查项目状态，然后汇报结果。");

turn.calledTool(
  toolMatch("get_weather", {
    input: jsonMatch({ city: "Taipei" }),
    output: jsonMatch({ forecast: "sunny" }),
    status: "completed",
  }).exactly(1),
).label("完成天气查询");

turn.calledTool(
  toolMatch("read_file", {
    input: referencesAnyPath([".env", "secrets/**"]),
  }),
).label("读取敏感路径");

turn.calledTool(commandMatch("pnpm", { argsStart: ["test"] }));
turn.calledTool(toolMatch("read_file").atLeast(2));
turn.notCalledTool(commandMatch("rm", { argsStart: ["-rf"] }));
```

普通 JSON 结构交给受管的 `jsonMatch`。路径搜索交给 `referencesAnyPath`，二者用在 `toolMatch` 的 JSON 条件中。命令 token 交给可直接作为 selector 的 `commandMatch`；不在局部 JSON 中写命令正则或自定义函数。

## 一个 occurrence 的合取

`ToolMatch` 每次只比较一个 `LogicalToolOccurrence`。名称、`input`、`output` 与 `status` 是同一 occurrence 上的 AND 条件。计数只数完整满足这一组条件的 occurrence，不会把一笔调用的输入和另一笔调用的输出拼成命中。

`toolMatch` 适用于官方工具和第三方工具。两者都按 Adapter 归一后的 occurrence、原始名称与材料状态求值，没有官方工具的特权分支。

## 输入、输出与 HITL

输入和输出材料各有 `complete`、`partial`、`unavailable` 三种状态。`complete` 有完整 JSON；`partial` 明示可见片段与缺失边界；`unavailable` 带具名原因，不能用空对象、`null` 或普通 mismatch 代替。

受管 Match 在 `partial` 材料中只有取得决定性正向见证时才可 matched。其余需要不可见部分的比较是 unavailable。`unavailable` 材料不会产生假阴性。

HITL 等待中的工具已有 `operation.started`，却还没有相配的 finished。它的 occurrence 状态是 `pending`，输出为 unavailable。匹配 `status: "pending"` 可以成立；要求输出的 Match 必须是 unavailable。缺少输出从不等同于输出不匹配。

## receiver、Session 与 vector cut

Turn receiver 只读取该不可变 Turn。Session receiver 读取该 Session 在调用处之前的全部 Turn，所以可以断言跨 Turn 的工具行为。

根 `t` 在调用处冻结所有已启动 Session 的 vector cut。每个 Session 保留自己的前缀，根 scope 不把多个 Session 伪造成一条全局时间线。之后新增的 Turn、Session 或工具调用不进入已登记 Assertion。

## 三值计数

每个候选 occurrence 先得到 `matched`、`mismatched` 或 `unavailable`。计数在这三种结果上求值，不能把未知当作零。

- `.exactly(n)`：已知匹配数超过 `n` 时确定 mismatched。只有已知匹配数等于 `n` 且其余候选都可判定时才 matched；否则为 unavailable。
- `.atLeast(n)`：已知匹配数达到 `n` 时立即 matched。已知匹配数不足且其余候选都可判定时才 mismatched；否则为 unavailable。
- `.greaterThan(n)`：按 `.atLeast(n + 1)` 的下限判据求值。
- 普通 ToolMatch 或工具名：按 `.atLeast(1)` 求值。
- `notCalledTool`：按精确零匹配求值。一个已知匹配即可 mismatched；只有所有候选都可判定且没有匹配时才 matched。
- `usedNoTools()`：对全部工具按精确零求值，完整性要求与 `notCalledTool` 相同。

这套规则也要求 receiver 的 actions 材料足以判定。材料不完整时，正断言、负断言和未达到的下限都保留 unavailable，而不是据空白认定结果。

## 版本边界

`ToolMatch`、scoped Assertion 与 Inspection operation 都不用 `V1` 或 `V2` 后缀。中高层 breaking
change 通过包与 API 升级交付，不要求用户改写已封口的 Record。

只有 `RecordAttachment` 的持久 schema 与跨进程 wire codec 使用版本号。Assertions current envelope 是
schemaVersion `4`；v3 的旧 matcher 事实通过相邻迁移显式保留为 `matcher-legacy`，不重跑、不猜测。持久 payload 规则见 [Architecture](../architecture.md)。
历史 `value-match/v1` 的 `maxToolCalls` 条目按原 criterion 读取，不推断、不迁移成 numeric 或 occurrence criterion。

Sandbox 专属结果断言见 [断言 Sandbox 结果](../../sandbox/library/asserting-results.md)。
