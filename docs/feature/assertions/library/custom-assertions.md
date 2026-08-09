# Assertions —— 自定义 Match

复用布尔规则时使用 `defineValueMatch`：

```ts
import { defineValueMatch, defineScoreMatch } from "niceeval/expect";

const jsonValid = defineValueMatch<string>({
  name: "jsonValid",
  evaluate(value) {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  },
});

const concise = defineScoreMatch<string>({
  name: "concise",
  score(value) {
    return value.length <= 200 ? 1 : 0.4;
  },
});

t.assert(t.check(t.reply, jsonValid));
t.assert(t.check(t.reply, concise), { atLeast: 0.7 });
```

`defineValueMatch` 必须返回 boolean。`defineScoreMatch` 必须返回有限 `[0,1]` 数字。throw、reject、非法结构和越界分数都是 evaluator error，而不是 failed 或 unavailable。

Match 只描述如何比较一个候选值。它不能返回 Fact、指定 verdict、标记可选性或直接计分。将自定义 ScoreMatch 的 Fact 传给 `assert`、`require` 或 `score`，才能声明其用途。
