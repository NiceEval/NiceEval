# 作用域 Assertion

同一组断言可以挂在 `t`、session 或 turn 上；接收者决定数据范围。

```ts
const first = await t.send("查布鲁克林天气");
first.calledTool("get_weather");       // 只看这一轮

const other = t.newSession();
await other.send("查旧金山天气");
other.calledTool("get_weather");       // 只看这条 session

t.calledTool("get_weather", { count: 2 }); // 全 attempt
```

## 共享词汇

| API | 断言内容 |
|---|---|
| `succeeded()` | 作用域没有失败，也没停在未回答的 HITL |
| `parked()` | 干净停在输入请求上 |
| `messageIncludes(token)` | assistant 文本包含 token |
| `calledTool(name, match?)` | 出现匹配的工具调用 |
| `notCalledTool(name, match?)` | 没有匹配工具调用 |
| `toolOrder(names)` | 工具按给定子序出现 |
| `usedNoTools()` | 没有工具调用 |
| `maxToolCalls(max)` | 工具调用数不超上限 |
| `loadedSkill(skill)` | 出现 `skill.loaded` 证据 |
| `calledSubagent(name, match?)` | 出现匹配的子 Agent 委派 |
| `noFailedActions()` | 没有 failed 工具或子 Agent 动作 |
| `event(type, opts?)` / `notEvent(type)` | 出现或未出现事件 |
| `eventOrder(types)` | 事件类型按给定子序出现 |
| `eventsSatisfy(label, predicate)` | 用谓词检查事件流 |
| `maxTokens(max)` / `maxCost(usd)` | token（`inputTokens + outputTokens`，cache 桶不计——护栏花钱用 `maxCost`）或估算成本不超上限 |

负断言和上限断言依赖完整证据。
所需通道非 complete 时，这些断言形成 `unavailable` Assertion Claim，不会按空证据静默通过；非 `.optional()` 断言评不了会形成 Attempt 的 `errored` Verdict Claim，而非 lifecycle state。
正断言在非 complete 通道上没找到匹配时，同样记 `unavailable` 而不是 failed。

`count` 为精确数字且实测已超出时是确凿失败。
partial 通道只会少采，超出不可能由采集造成。
 `count` 为谓词且不满足时，非 complete 通道上一律记 `unavailable`。
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
interface SubagentMatch {
  count?: number | ((n: number) => boolean);
  status?: "pending" | "completed" | "failed";
  remoteUrl?: string | RegExp | ((url: string) => boolean);
  output?: JsonMatch;
}
```

`JsonMatch` 只允许 JSON 标量 / 数组 / 对象、`RegExp` 和 `(value: unknown) => boolean`；不会把 `Date`、`Map` 或任意类实例存进 match。需要检查这类动态运行时形状时，把判断写进显式谓词。

`remoteUrl` 只匹配指向该远程地址的子 Agent 委派，`output` 匹配子 Agent 返回。
 `event(type, opts?)` 的 `opts` 是 `{ count?: number | ((n: number) => boolean) }`，计数语义相同。

```ts
t.calledTool("get_weather", { input: { city: "Brooklyn" }, count: 1 });
t.calledTool("file_read", { count: (n) => n >= 2 });           // 次数在 count 里,不是严重度修饰
t.calledTool("shell", { input: { command: /curl/ }, output: /tutorials\// }); // 入参与输出一起断
t.calledTool("batch", { output: [{ id: 1 }, { id: (value) => typeof value === "number" }] });
t.notCalledTool("bash", { input: { command: /npm i/ } });      // 值位置用 RegExp

t.calledSubagent("weather", {
  remoteUrl: (url) => url === process.env.WEATHER_AGENT_URL,
  output: /72F/,
});

// HITL:停在审批上的调用是 pending;被拒后是 rejected,不是 failed
const draft = await t.send("发布前要我确认。");
draft.calledTool("send_email", { status: "pending", count: 1 });
const request = t.requireInputRequest({ optionIds: ["approve", "reject"] });
await t.respond({ request, optionId: "reject" });
t.calledTool("send_email", { status: "rejected" });
```

严重度与匹配条件正交：作用域断言默认 gate；降级成软指标链 `.atLeast(1)`——参数是分数线，不是调用次数，次数在 `count` 里表达；只留档、不设线用无参 `.soft()`（裁决见 [Severity 与 Verdict](../../verdict/architecture.md#severity)）。

## 顺序与谓词

`toolOrder(names)` / `eventOrder(types)` 断言的是**子序**：目标项按给定相对顺序出现即通过，中间夹杂其它调用或事件不影响结果：

```ts
t.toolOrder(["read_file", "write_file"]);          // 先读后写;中间调了别的工具也通过
t.eventOrder(["operation.started", "operation.finished"]);
```

规则超出既有词汇时，用 `eventsSatisfy(label, predicate)` 对作用域的整段事件流写谓词。
`label` 必填、进报告名——谓词是词汇表里最不透明的断言，没有名字的失败在报告里读不懂；`predicate` 是 `(events: readonly StreamEvent[]) => boolean`：

```ts
t.eventsSatisfy("thinking 不超过 3 次", (events) =>
  events.filter((e) => e.type === "thinking").length <= 3,
);
```

## 接收者专属能力

| 接收者 | API | 原因 |
|---|---|---|
| `t` | `check`、`require`、`skip`、`log`、`group` | 登记或控制整个 attempt |
| `t` | `newSession()` | 只有主上下文创建额外 session |
| `t` | `sandbox.*` | Sandbox 是 attempt 资源 |
| turn | `outputEquals(value)`、`outputMatches(schema)` | 直接评价这一轮的 `turn.data` |

不要为了表面一致把这些能力下放给 session 或 turn。

各断言失败时在 show / view 里显示什么（含负断言的反例定位），见 [断言与 Turn 的展示](display.md)。
