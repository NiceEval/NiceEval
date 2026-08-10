# Assertions —— 值 Fact

从 `niceeval/expect` 导入纯 Match factory，再用 consumer-first 调用创建并消费 Fact：

```ts
import { includes, isDefined, matches, similarity } from "niceeval/expect";

const reply = await t.require(t.reply, isDefined("reply"));
t.check(reply, includes("Brooklyn"));
t.check(turn.data, matches(ResultSchema));
t.check(reply, similarity("Brooklyn is sunny.").atLeast(0.8));
```

value 加 BooleanMatch 的 `check` 原子创建 BooleanFact 并登记 verdict use。value 加 ThresholdedScoreMatch 的 `check` 原子创建 ScoreFact、登记带阈值的 verdict use，并返回 ScoreFact。`require(value, match)` 是立即便利写法：它创建 Fact、登记 verdict use，并返回原值的 refinement 或归一化分数。

Match 不带 severity、可选性、分值或停止策略。ScoreMatch 只额外提供纯 `.atLeast(n)`，把连续分数包装成 verdict 输入；已有 ScoreFact 使用同样的 `.atLeast(n)`。计分不消费 threshold view，仍写 `t.score(label, fact, { max })`；常见值计分可直接写 `t.score(label, value, scoreMatch, { max })`。

```ts
const quality = similarity("Brooklyn is sunny.");

t.check(reply, quality.atLeast(0.8));
const normalized = await t.require(reply, quality.atLeast(0.9));
t.score("相似度", reply, quality, { max: 4 });
```

`t.check(reply, quality)` 与 `t.check(reply, quality, { atLeast: 0.8 })` 都是类型错误。`t.score` 也拒绝 `quality.atLeast(0.8)`，避免在计分路径静默丢掉阈值。

## Match factory

| Factory | 结果 |
|---|---|
| `includes`、`excludes`、`pattern` | 字符串 BooleanMatch |
| `equals` | 深相等 BooleanMatch |
| `matches` | Standard Schema 输入收窄 |
| `isDefined`、`isTrue`、`isFalse` | 常用 BooleanMatch |
| `similarity` | `[0,1]` ScoreMatch |
| `satisfies`、`defineValueMatch` | 自定义 BooleanMatch |
| `defineScoreMatch` | 自定义 ScoreMatch |

ScoreMatch 返回非有限数或 `[0,1]` 外的值是 evaluator error。NiceEval 不把它裁剪成可用分数。

`t.group(title, fn)` 只组织 Fact 和 use 的 source group。它不改变 Fact 结果、阈值或计分。
