# Assertions —— value assertions

值比较的共同模型在 [Assertions](../README.md)。`check(subject, match)` 在调用时读取传入的 subject 并直接登记 Assertion。
root `t`、Session 与 Turn 都提供这一入口。

## 两个参数

```ts
const parsed = t.check(rawConfig, matches(ConfigSchema))
  .label("配置符合 schema");
```

`check` 没有一参数、三参数或 handle 重用形状。`Match` 只比较传入的 subject；它没有 callsite、subject identity、
groupPath、score、threshold 或控制流，也不从 ctx 自行取值。
受管 `toolCalls` 是合法 subject；collection Match 见 [Scoped assertions](scoped-assertions.md)。

`check` 保存已求值 value 的安全 snapshot 或 ref，而不是只保存 Match 的成功 / 失败。命令结果等大型 subject
的字段要求见 [Evidence · 显式 value snapshot](../architecture/evidence.md#显式-value-snapshot)。

## 数值比较

`niceeval/expect` 公开四个 Boolean matcher。工厂 threshold 必须是有限 number；非法 threshold 在调用 matcher 工厂时就是作者错误。非 number candidate 可以作为调用错误拒绝；candidate 已经是 number 但值为 `NaN` 或正负 `Infinity` 时，这条 Assertion 形成 unavailable，不能记为作者错误或普通 mismatch。

```ts
declare function lessThan(threshold: number): BooleanMatch<number>;     // candidate < threshold
declare function atMost(threshold: number): BooleanMatch<number>;       // candidate <= threshold
declare function greaterThan(threshold: number): BooleanMatch<number>;  // candidate > threshold
declare function atLeast(threshold: number): BooleanMatch<number>;      // candidate >= threshold
```

```ts
t.check(latencyMs, lessThan(1_000)).label("延迟低于一秒");
t.check(successRate, atLeast(0.95)).label("成功率至少 95%");
t.check(-1, lessThan(0)).label("负数小于零");
```

generic numeric matcher 允许负 threshold 与负 candidate。非负约束只属于 Usage token／cost scope material，以及 pricing receipt 中的 token count、rate 和 amount。

这里的 `atLeast(0.95)` 是一个 Match，负责比较 `t.check` 提供的候选事实。Assertion handle 上的 `.atLeast(0.8)` 则为 `[0,1]` measurement 设置 condition；它不构造 Match，也不比较任意 number subject。两者同名但调用点、输入和值域不同。

四个 matcher 都登记 `numeric-comparison/v1` criterion。`value-match/v1` 只表示没有可解释数值运算的旧值比较；reader 不从 matcher 名、observed number 或展示文本推断升级它。

## refinement

Boolean Match 可以 refinement 原 subject。需要中止当前 continuation 时，在同一 handle 上 await
`.orStop()`：

```ts
const config = await t.check(rawConfig, matches(ConfigSchema))
  .label("配置有效")
  .orStop();

config.name.toUpperCase();
```

这不会登记第二条 Assertion。catch 不会清除 stop latch，之后的 NiceEval 作者 API 会拒绝登记。

## measurement

连续 Match 返回 finite `[0,1]` measurement。Pass Eval 用 `.gate(n)` 才让低于阈值的结果进入 failed；`.atLeast(n)` 只保存局部 condition。Score Eval 可直接
`.score(points)`，并可额外 `.atLeast(n)` 保存局部 condition。Score Eval 没有 gate；
具体计分见 [Score Eval](score-points.md)。
