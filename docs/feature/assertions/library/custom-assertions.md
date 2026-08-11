# Assertions —— 自定义 Match

完整模型见 [Assertions](../README.md)。自定义 Match 只描述“这个 value 怎样比较”，不描述作者位置、
scope、policy 或运行控制。

## Match 的边界

一个 Match 必须可复用、不可变、确定性且无副作用。它可以返回 Boolean result，或 finite `[0,1]`
measurement。它不能保存 subject identity、callsite、groupPath、`key`、`label`、score 或 threshold。

```ts
const hasRequiredFields = defineValueMatch((value: unknown) =>
  isRecord(value) && typeof value.id === "string" && typeof value.title === "string",
);

t.check(payload, hasRequiredFields).label("返回必填字段");
```

Match 与 Assertion 分工明确：Match 比较 value；`t.check(value, match)` 读取调用时 value 并登记
Assertion；handle 再配置同一 entry。

## 连续 evaluator

连续 Match 返回 finite `[0,1]` measurement。Pass Eval 必须把它 `.atLeast(n)`；Score Eval 可以直接
`.score(points)`，也可以同时添加局部 threshold。

```ts
const similarity = defineScoreMatch((actual: string) => compare(actual, expected));

pass.check(reply, similarity).atLeast(0.8);
score.check(reply, similarity).score(5).atLeast(0.8);
```

`atLeast`、`gate`、`score` 和 `orStop` 都不属于 Match。它们是登记后的 AssertionHandle 配置。

## 第三方 criterion

第三方 evaluator 可以有自己的 criterion schema，但 Assertions v1 只保存精确的 `{ name, schemaId, data }`。
它不保存 evaluator 函数、模块对象、闭包或运行时 dependency graph。`schemaId` 未安装或 `data` 无法解码时，
reader 只把该 entry 标为 `unsupported` 或 `invalid`；同一 Attachment 的其它 entry 继续可读。
