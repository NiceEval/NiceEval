# 值断言

从 `niceeval/expect` 导入 matcher，再用 `t.check` 或 `t.require` 评分任意值。

```ts
import { includes, matches, isDefined } from "niceeval/expect";

const reply = await t.require(t.reply, isDefined("reply"));
t.check(reply, includes("Brooklyn"));
t.check(turn.data, matches(MySchema));
```

## `check` 与 `require`

- `t.check(value, matcher)` 同步记录断言并继续执行，适合一次收集多条结果。
- `await t.require(value, matcher)` 立即等待；不通过就按 gate 中止依赖它的后续代码，通过后返回原 value。

只有后续逻辑依赖这个值时才使用 `require`。`require` 是**通过制**（`defineEval`）的前置词；计分制（`defineScoreEval`）的 `t` 上没有它，前置写成 `t.check(value, matcher).gate()`——同一件事，还能顺带挣分（见 [Severity 与 Verdict · 计分制里的 `.gate()`](../architecture/severity-and-verdict.md#计分制里的-gate前置中止)）。

## 内置 matcher

| Matcher | 用途 | 默认严重度 |
|---|---|---|
| `includes(needle, opts?)` | 包含字符串或命中正则 | gate |
| `excludes(needle, opts?)` | 不包含字符串或不命中正则 | gate |
| `equals(expected)` | 深度相等 | gate |
| `matches(schema)` | Standard Schema / Zod 校验 | gate |
| `similarity(expected)` | `[0,1]` 编辑距离相似度 | soft（阈值 0.6） |
| `includesUrl(min?)` | 含至少 min 条（默认 1）去重后的 http(s) 链接 | gate |
| `hasSections(min?)` | 含至少 min 个（默认 2）Markdown 标题 | gate |
| `satisfies(predicate, label?)` | 自定义谓词 | gate |
| `isDefined(label?)` | 非 null / undefined | gate |
| `isTrue(label?)` / `isFalse(label?)` | 严格布尔判断 | gate |
| `commandSucceeded()` | 命令退出码为 0 | gate |

`includes` / `excludes` 的 `opts` 是 `{ stripComments?: boolean }`：`stripComments` 先剥掉代码注释再匹配，用于只对真实代码断言、不被注释里的字面量干扰：

```ts
t.check(t.sandbox.diff.get("src/weather.ts"), excludes(/console\.log/, { stripComments: true }));
```

`satisfies` 的 `predicate` 是 `(value: unknown) => boolean`，真记 1 分、假记 0 分；`label` 进报告名：

```ts
t.check(turn.data, satisfies((v) => Array.isArray(v) && v.length <= 5, "最多 5 条结果"));
```

`similarity(expected)` 是归一化编辑距离（1 − Levenshtein ÷ 较长串长度），不是语义相似度——同义改写、语序调整会得低分，适合期望输出接近逐字稳定的场景；语义评价用 [LLM-as-judge](judge.md)。

`includesUrl(min?)` / `hasSections(min?)` 是**内容形状断言**：不判语义，只判回答具不具备预期产出的形状（带来源链接、有小节结构）。它们的定位是没有 Judge key 时的兜底——比「断言输入里本来就有的词」强一个量级（复读题目糊弄不过去），但判不了内容真伪；有 Judge 时语义质量仍交给 [LLM-as-judge](judge.md)。URL 按去重后的完整链接计数；标题按行首 `#` 到 `######` 计数。

## 改严重度与阈值

每个 matcher 都可以链 `.gate(threshold?)`、`.atLeast(threshold)`、`.soft()` 或 `.optional()`，
返回新的不可变 matcher，原实例不变、可复用：

```ts
const nearEnough = similarity("布鲁克林今天晴。");
t.check(t.reply, nearEnough.atLeast(0.9));   // 收紧默认的 0.6；nearEnough 本身不变
t.check(reply2, nearEnough.gate(0.8));       // 同一个 matcher 换一档严重度复用
```

写下这四个词各会怎样向上传播——`.gate` 是硬要求、`.atLeast` 的参数是分数线、`.soft()`
不设线、`.optional()` 允许证据缺席——逐行标注在
[Severity 与 Verdict](../architecture/severity-and-verdict.md#severity)。
计分制（`defineScoreEval`）里 matcher 上链的严重度只贡献**通过线**，角色由断言句柄上的
`.points(n)` / `.gate(x?)` 决定，见
[计分制里的 `.gate()`](../architecture/severity-and-verdict.md#计分制里的-gate前置中止)。

每个 matcher 失败时在 show / view 里显示什么，见 [断言与 Turn 的展示](display.md)。

## 分组

`t.group(title, fn)` 组织报告区块，并给对比提供得分点维度；不改变各断言分数或严重度，也不参与判定：

```ts
await t.group("天气查询", async () => {
  t.check(t.reply, includes("Brooklyn"));
  t.calledTool("get_weather");
});
```

分组可以嵌套，返回 `fn` 的返回值。组名在对比读取面按字面聚合成跨 eval 可比的得分点：计分制下读组内挣分之和，通过制下读组质量分（soft 断言均值），gate 失败按组定位「死在哪层」；同类检查在不同 eval 里保持组名一致——折叠语义见[计分粒度](score-points.md)。
