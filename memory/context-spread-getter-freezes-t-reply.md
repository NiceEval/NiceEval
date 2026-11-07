# t.reply / t.events / t.sessionId 在顶层 `t` 上永远冻结在初始值

## 现象

`t.check(t.reply, includes("2"))` 明明助手回复里含 "2",断言却总是失败(`includes("2")` score=0)。
同理 `t.events`(顶层)总是空数组、`t.sessionId`(顶层)总是 `undefined`,即使已经 `await t.send(...)` 过。
只有 `t.newSession()` 返回的 session handle 上同名的 getter 是好的;只有**顶层 `t`**(`TestContext`)出问题。
`t.usage`「碰巧」没事——因为它是同一个可变对象的引用,内部字段被原地 mutate,不受影响。

## 根因

`src/context/context.ts` 的 `createEvalContext` 里,`primary = makeSessionHandle(manager.primary)` 上
`reply`/`sessionId`/`events`/`usage`/`judge` 是用 `get xxx() {...}` 定义的**真 getter**,读的是
`manager.primary`(`RunSession`)的实时状态。但组装顶层 `context` 时用的是对象展开
`const context: TestContext = { ...primary, ...额外字段 }`——**对象展开会在展开的那一刻把每个 getter
求值成静态值**,而这一刻发生在任何 `t.send()` 之前,所以 `reply` 被永久冻结成 `""`、`events` 冻结成
`[]`、`sessionId` 冻结成 `undefined`。`usage` 没事纯属巧合:它的 getter 返回的是 `session.usage` 这个
对象的**引用**,后续 `accumulateUsage` 原地 mutate 同一个对象,展开出来的那份引用跟着"看起来"更新了。

`t.newSession()` 返回的 handle 是 `makeSessionHandle(...)` 的直接返回值,没有被展开过,getter 照常生效,
所以只有顶层 `t` 中招——这也是这个 bug 长期没被发现的原因,大部分排查会先试 `newSession()` 分支。

## 修法

不要对带 getter 的对象做 `{ ...obj, ... }` 展开。改用 `Object.getOwnPropertyDescriptors(obj)` 搬运
属性描述符再 `Object.defineProperties` 装配,getter 保持 getter:

```ts
const context = Object.defineProperties(
  {},
  { ...Object.getOwnPropertyDescriptors(primary), ...Object.getOwnPropertyDescriptors(extra) },
) as TestContext;
```

这个坑不只这一处——`src/` 里任何「基础对象是 getter,组装上层对象时想省事直接展开」的写法都要查一遍。
写回归测试时优先测「`send()` 之后读顶层 `t.reply`/`t.events`/`t.sessionId`」,不要只测 `newSession()` 分支,
否则测不出这类 bug。回归测试见 `src/context/context.test.ts`。
