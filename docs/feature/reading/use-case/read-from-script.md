# 脚本里读结果

不是每种消费都长成一张报告。
CI 要一个门禁判断,周报要一个数,别的系统要一份自己的 JSON。
这些直接在 TS 里读。

## 三个入口,按需要多少判断挑

```typescript
import { openRecord } from "niceeval/record";
import { currentSample } from "niceeval/sample";

const record = await openRecord(".niceeval");
const sample = currentSample(record, { experiments: "compare/" });
```

| 你要什么 | 从哪进 |
|---|---|
| 官方口径的一批 attempt,连覆盖与警告一起 | `latestRunSample` / `currentSample` |
| 官方口径的折叠数字(表格、矩阵、散点) | [Reports 的计算函数](../../reports/library.md) |
| 连口径都自定义(例如全历史的分布) | 直接遍历 `record.experiments` |

判据是**你需要多少判断**:要与 `show` / `view` 首页对上数字就从选择器出发;要一条别人没有的口径, 才下沉到 Record。

## CI 门禁:先判覆盖,再判通过

覆盖缩水比失败更隐蔽 —— 分母少了几道题,通过率反而好看。
所以门禁先判覆盖:

```typescript
const shrunk = sample.coverage.some((c) => c.missingEvalIds.length > 0);
if (shrunk) process.exit(1);
```

缺口是具体哪几道题,不是一个布尔值,报错时直接列出来,读的人不用再去猜。

## 两条最常踩的线

**别自己 `flatMap` 一遍 `runs`。**
 `sample.attempts` 是按口径挑好的全集,自己展开 `runs` 会把同一道题的历史 attempt 重复计入。
要 Run 级信息(配置、producer、diagnostics)才读 `sample.runs`, 它保留给这个用途。

**聚合自己算,不要去找落盘的合计。**
 通过率、总成本、p90 都不在磁盘上,由逐条结果现算 —— 这是[跨层不变量](../README.md#跨三层的不变量)第一条。
找不到「总数字段」不是缺功能。

## 要证据就往下钻

每个样本成员是 `AttemptHandle`,重证据按需读盘:

```typescript
for (const attempt of sample.attempts) {
  if (attempt.result.verdict !== "failed") continue;
  const events = await attempt.events();     // 没写过这份证据时返回 null
}
```

这是「每个数字都能回到证据」在脚本侧的样子:算出一个可疑的数,当场从同一个对象打开它的对话、trace 或 diff,不需要另拼一次路径。
携带条目的证据在原 Run 里,读取面按 `artifactBase` 自动回落;原 Run 被删了则如实报 `dangling`,不与「没采集」混为一谈。

## 不写 TS 的消费方

只想要一份机器可读的事实,用 [`show --json`](../../reports/show/json.md)。
它输出「是什么」,不输出「怎么看」—— 要自定义结构就拿它再加工,不要为此去写报告树。
