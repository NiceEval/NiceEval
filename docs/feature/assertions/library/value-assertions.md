# Assertions —— value assertions

值比较的共同模型在 [Assertions](../README.md)。`t.check(value, match)` 在调用时读取显式 `value` 并直接
登记 Assertion。

## 两个参数

```ts
const parsed = t.check(rawConfig, matches(ConfigSchema))
  .label("配置符合 schema");
```

`check` 没有一参数、三参数或 handle 重用形状。`Match` 只比较 value；它没有 callsite、subject identity、
groupPath、score、threshold 或控制流。

`check` 保存已求值 value 的安全 snapshot 或 ref，而不是只保存 Match 的成功 / 失败。命令结果等大型 subject
的字段要求见 [Evidence · 显式 value snapshot](../architecture/evidence.md#显式-value-snapshot)。

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

连续 Match 返回 finite `[0,1]` measurement。Pass Eval 必须 `.atLeast(n)`；Score Eval 可直接
`.score(points)`，并可额外 `.atLeast(n)`。Score Eval 要让此 condition 改变 Verdict 时，再调用 `.gate()`；
具体计分见 [Score Eval](score-points.md)。
