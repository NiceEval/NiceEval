# Assertions —— scoped methods

scope 语义由 [Assertions](../README.md#scope-与-succeeded) 单独定义。本页只列出作者调用形状。

```ts
const turn = await t.send("查找配置并汇报。");

t.succeeded().label("所有已启动会话完成");
turn.succeeded().label("当前 Turn 完成");
turn.calledTool("search", { count: { atLeast: 1 } }).label("至少一次搜索");
```

每一次调用都直接登记 Boolean Assertion。receiver 决定 snapshot，不能通过随后发生的 Session 或 Turn
改写。`t` 读取已启动 Session 的 vector cut；Session 读取自己的前缀；Turn 读取不可变 Turn。

`calledTool(...)` 与 `loadedSkill(...)` 是 `check(a, b)` 的特例：它们从 receiver scope 取得 normalized
occurrences 作为 subject `a`，用方法参数构造 evaluator `b`，并登记 evaluation。保存的 `a` 包括 scope、
operation / event identity、input、status、output / error refs、coverage 与匹配 event refs。

负断言和上限断言依赖完整证据。
所需证据 Attachment 的 collection 非 complete 时，这些断言形成 `unavailable` Assertion result，不会按空证据静默通过；非 `.optional()` 断言评不了会形成 Attempt 的 `errored` Verdict，而非 lifecycle state。
正断言在非 complete Attachment 上没找到匹配时，同样记 `unavailable` 而不是 failed。

`count` 为精确数字且实测已超出时是确凿失败。
partial Attachment 只会少采，超出不可能由采集造成。
 `count` 为谓词且不满足时，非 complete Attachment 上一律记 `unavailable`。
缺证据的计数没有可信判定。
完整度声明与消费规则见 [证据与完整性](../architecture/evidence.md)。
Sandbox 专属结果断言见 [断言 Sandbox 结果](../../sandbox/library/asserting-results.md)。

## 匹配条件的字段全集

`calledTool` / `notCalledTool` 的 `match` 是 `ToolMatch`。**
一条调用的全部可断面——入参、次数、输出、状态——都在这一个 match 对象里表达**，不借助断言句柄。
`input` / `output` / `status` 之间是 AND，且作用在**同一笔调用**上；`count` 数的是满足这些条件的调用笔数——不存在「一笔满足 input、另一笔满足 output」也算命中的读法：

| 字段 | 语义 |
|---|---|
| `input?: JsonMatch` | 递归匹配小语言：JSON 标量严格相等；对象做**深度部分匹配**；数组等长逐项匹配；`RegExp` 与谓词 `(value: unknown) => boolean` 可出现在任意层级。正则先匹配当前位置的字符串，不命中时再匹配完整输入的序列化文本；谓词是唯一接收动态 `unknown` 的边界 |
| `count?: number \| ((n: number) => boolean)` | 数字＝恰好 n 次；谓词＝对命中次数自行判定（`(n) => n >= 2`）；省略＝至少一次 |
| `output?: JsonMatch` | 与 `input` 使用同一递归 `JsonMatch`：JSON 标量、数组、对象、`RegExp` 或动态谓词；对象仍是部分匹配，数组是等长逐项匹配 |
| `status?: "pending" \| "completed" \| "failed" \| "rejected"` | 只匹配处于该状态的调用。`pending` 是已发起、尚无结果的调用——典型是 HITL 停在审批上的那一笔 |

`calledSubagent` 的 `match` 是 `SubagentMatch`，语义同 `ToolMatch`：

```ts
turn.usage.maxTokens(4_000)
  .ifCovered()
  .label("token 使用量可读取");
```

普通 scoped Assertion 在 Pass Eval 默认投影为 Verdict condition。在 Score Eval 它默认只保存 evaluation；需要贡献
score 时调用 `.score(n)`。Boolean scoped handle 可 `await .orStop()`。
