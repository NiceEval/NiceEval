# `brief(undefined)` 抛 TypeError，断言预览 undefined 字段值时崩溃而不是显示 "undefined"

**现象**：`t.check(某字段, equals("期望值"))` 在「某字段」实际是 `undefined` 时,gate 求值本身
崩溃(不是断言失败,是断言机制本身抛错),错误信息是:

```
gate: equals("1.3.2") — evaluation error: TypeError: Cannot read properties of undefined (reading 'length')
    at brief (src/util.ts:64:9)
    at previewCheckedValue (src/context/context.ts:122:12)
```

`src/context/context.ts` 的 `previewCheckedValue()`(断言失败时给 view 看「实际被检查了什么」)
兜底调用 `brief(value, 4000)`,不管 `value` 是什么都会经过这条路径。

**根因**：`src/util.ts` 的 `brief()` 用 `JSON.stringify(value)` 序列化非字符串值,但
`JSON.stringify(undefined)` 返回的是**值 `undefined`**,不是字符串 `"undefined"`(这是
`JSON.stringify` 一个常见反直觉行为:对 `undefined`/函数/`Symbol` 返回 `undefined` 而不是抛错
或给字符串)。`s` 因此变成非字符串,紧接着的 `s.length > max` 直接抛 `TypeError`。这条路径此前
从未被真实触发过,是因为此前没有 eval 断言过一个「本来就该是 undefined」的字段值。

**修法**：`JSON.stringify(value) ?? String(value)` 兜底(`String(undefined)` = `"undefined"`),
修在 `src/util.ts` 的 `brief()`。新增 `src/util.test.ts` 的 `describe("brief", …)` 回归测试
(undefined 不抛错且显示为 `"undefined"`、普通值透传/JSON 化正常、超长截断保留 `…`)。

**发现方式**：codex native plugin 真机 e2e([[codex-plugin-list-json-shape-guessed-wrong]]导致的
`resolvedVersion` 真的是 `undefined`)断言 `equals("1.3.2")` 时撞见——不是构造出来的边界用例,是
两个真实 bug 叠加暴露的第三个 bug:一个字段真的取不到值,恰好把断言预览这条此前无人走到的
undefined 分支跑到了。

已修复:`src/util.ts` `brief()`(2026-07-13,与 [[codex-plugin-list-json-shape-guessed-wrong]] 同一次
e2e 复现同时修复)。
