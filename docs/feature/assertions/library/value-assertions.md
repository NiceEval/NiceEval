# Assertions —— 值 Fact

从 `niceeval/expect` 导入纯 Match factory，再用 `t.check` 创建 Fact：

```ts
import { includes, isDefined, matches, similarity } from "niceeval/expect";

const reply = await t.require(t.check(t.reply, isDefined("reply")));
const mentionsBrooklyn = t.check(reply, includes("Brooklyn"));
const dataIsValid = t.check(turn.data, matches(ResultSchema));
const quality = t.check(reply, similarity("Brooklyn is sunny."));

t.assert(mentionsBrooklyn);
t.assert(dataIsValid);
t.assert(quality, { atLeast: 0.8 });
```

`check` 创建惰性 BooleanFact 或 ScoreFact。它不自行改变 verdict。`require(value, match)` 是即时便利写法：它创建 BooleanFact、登记 verdict use，并返回原值的收窄类型。

Match 不带 severity、可选性、分值或停止策略。阈值写在 `t.assert(scoreFact, { atLeast })` 或 `t.require(scoreFact, { atLeast })`；计分写在 `t.score(label, fact, { max })`。

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
