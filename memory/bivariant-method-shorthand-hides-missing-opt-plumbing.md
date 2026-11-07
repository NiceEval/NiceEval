# 方法简写属性的双变检查,让漏接的新 opts 字段 typecheck 全绿

- **现象**:给 `Results.latest`/`Results.current` 的 opts 类型加了 `fresh?: boolean` 后,`pnpm run typecheck` 全程零报错;但 `results.latest({ fresh: true })` 实际不生效——`fresh` 字段被静默丢弃,行为测试跑出来才发现 `fresh: true` 和不传完全一样。
- **根因**:`src/results/open.ts` 的 `makeResults()` 用对象字面量的**方法简写语法**实现 `Results` 接口:
  ```ts
  const results: Results = {
    latest(opts?: { experiments?: string | string[] }): Scope { return selectLatest(results, opts); },
    // 少了 opts.fresh,类型标注也没写 fresh
  };
  ```
  TypeScript 对**方法简写属性**(`foo() {}`,区别于箭头函数属性 `foo: () => {}`)的参数做**双变(bivariant)检查**,不是正常的逆变检查——所以一个参数类型更窄(缺 `fresh`)的方法实现,照样能赋值给要求参数类型更宽(带 `fresh`)的接口成员,不报错。箭头函数属性会用严格的逆变检查,这类漏字段会立刻报错。
- **How to apply**:
  1. 接口新增一个可选 opts 字段(尤其是给回调/方法签名加字段)后,**光靠 `pnpm run typecheck` 通过不能证明所有实现方都接住了新字段**——这类改动必须配一条真正跑一遍该字段生效路径的行为测试(不是只测类型能编译),本例是 `results.latest({ fresh: true })` 的差异化断言。
  2. 如果要让 TypeScript 帮忙拦截这类漏改,把接口里的方法签名从 `foo(opts?: X): Y` 改写成属性签名 `foo: (opts?: X) => Y`(箭头函数类型),对象字面量实现方对应也写成箭头函数赋值,能换回严格的参数逆变检查;但这是一次全仓库风格改动,本次未做,只记录风险点。
  3. 排查思路:凡是「加了新 opts 字段,typecheck 绿但行为不对」,先检查该接口方法是不是方法简写语法实现的——双变检查是 TS 里少数几个已知会放行「实现比接口窄」的口子之一。

- **已修**:`src/results/open.ts` 的 `makeResults()` 两个方法都已加宽并真正透传——`latest(opts?: { experiments?: string | string[]; fresh?: boolean })` 与 `current(...)` 各自把 `fresh: opts?.fresh` 交给 `selectLatestResults`/`selectCurrentResults`。第 2 点建议的「接口方法签名全仓改箭头函数属性」仍未做,风险点照旧。
- **复发**:同一形状(可选字段加了、调用点没接住、typecheck 全绿)在 2026-07-24 又撞了四次,见 [optional-field-additions-need-call-site-census](optional-field-additions-need-call-site-census.md)——本条是那次复盘认定的首次案例。
