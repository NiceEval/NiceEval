# 自定义断言

内置 matcher 无法表达规则时，用 `makeAssertion` 创建同步或异步 matcher。

```ts
import { makeAssertion, type Assertion } from "niceeval/expect";

function jsonValid(): Assertion {
  return makeAssertion({
    name: "jsonValid",
    severity: "gate",
    score(value) {
      try {
        JSON.parse(String(value));
        return 1;
      } catch {
        return 0;
      }
    },
  });
}

t.check(t.reply, jsonValid());
```

spec 的字段全集：

| 字段 | 语义 |
|---|---|
| `name: string` | 报告里显示的断言名——谓词不可展示，名字是失败的全部解释，展示形态见 [断言与 Turn 的展示](display.md#值断言) |
| `severity?: "gate" \| "soft"` | 省略默认 `gate` |
| `threshold?: number` | 及格线：分数 ≥ 阈值通过；省略时 gate 按「分数 > 0」及格，soft 只记分不判定 |
| `score: (value) => number \| Promise<number>` | 返回 `[0,1]` 分数，可以是异步函数 |

`score` 是异步时，评分在 finalize 阶段 await，eval 代码不需要额外等待。典型场景是把值交给外部工具或服务打分：

```ts
function passesTypecheck(): Assertion {
  return makeAssertion({
    name: "passesTypecheck",
    async score(value) {
      const result = await runTsc(String(value));
      return result.errorCount === 0 ? 1 : 0;
    },
  });
}
```

产出的 matcher 与内置 matcher 一样可以链 `.gate(threshold?)` / `.atLeast(threshold)` 调级（见 [值断言 · 改严重度与阈值](value-assertions.md#改严重度与阈值)）。

Assertion 适合评价一个值或一个 scope。跨 attempts 的 pass@k、均值和趋势属于 reporter metric，不应在单 attempt Assertion 中自行读取历史结果。

优先组合已有 matcher；只有新的评分语义才创建新 Assertion，不为业务字段包装一层只转发参数的别名。
