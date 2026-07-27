# Assertion 作用域绑定

作用域由接收者决定，不由断言名字决定。同一套作用域断言共享同一份实现，只替换 selector
与求值时机——把同一行断言挂到另一个接收者上，读的数据和求值的时刻都跟着变。

| 接收者 | Selector | 求值时机 |
|---|---|---|
| `t` | attempt 的全部 session 和 turn | 延迟到 test 结束后对聚合结果求值 |
| session（`t.newSession()` 的返回值） | 该 session 在记录断言时已有的事件和 usage | 记录时求值 |
| turn（`t.send()` 的返回值） | 该轮不可变的事件、状态和 usage | 记录时求值 |

```ts
const first = await t.send("查布鲁克林天气");
first.calledTool("get_weather");
//  turn 接收者:记录这一行时就对该轮的不可变事件求值,之后再发生什么都不改这条结论

const other = t.newSession();
await other.send("查旧金山天气");
other.calledTool("get_weather");
//  session 接收者:记录时求值,只看这条 session 到此刻为止的事件
//  写在下一次 other.send() 之前和之后,读到的事件不是同一批

t.calledTool("get_weather", { count: 2 });
//  t 接收者:延迟到 test 结束后,对全部 session、全部轮次的聚合结果求值
//  上面两条 session 各自那一次调用都数进这个 2
```

`t.newSession()` 创建的 session 仍属于当前 attempt，因此它的事件进入 `t.*` 聚合，但不会进入
主 session 的即时 `t.reply` / `t.events` 读取视图。

`t.*` 的聚合是有意设计，不是要消除的黑箱——「对整个 attempt 断言」是真实需求，把它做成一等
作用域比让用户手工拼接每轮回复更诚实。`Attempt` 只作为 runner / results 的执行单位存在，
不是 authoring 层的接收者。

值断言只评价显式传入值；Sandbox diff 是 attempt 级最终资源；judge 默认材料按接收者分层。
这些 scope 不能为了 API 表面一致而混合。

词汇全集、匹配条件与接收者专属能力见 [作用域断言](../library/scoped-assertions.md)；
Session 和 Turn 的 author-facing 获取方式见 [Eval Context](../../eval/library/context.md)。
