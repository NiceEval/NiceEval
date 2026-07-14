# 作用域断言

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
| `maxTokens(max)` / `maxCost(usd)` | token 或估算成本不超上限 |

负断言和上限断言依赖完整证据；所需通道非 complete 时这些断言记为 `unavailable`（非 `.optional()` 断言评不了使 attempt `errored`），不会按空证据静默通过；正断言在非 complete 通道上没找到匹配同样记 `unavailable` 而不是 failed。覆盖声明与消费规则见 [证据与完整性](../architecture/evidence.md)。

Sandbox 专属结果断言见 [断言 Sandbox 结果](../../sandbox/library/asserting-results.md)。

## 匹配条件的字段全集

`calledTool` / `notCalledTool` 的 `match` 是 `ToolMatch`，多个字段之间是 AND：

| 字段 | 语义 |
|---|---|
| `input?` | 入参匹配小语言：对象做**深度部分匹配**（写出的键值要求出现且相等，未写的忽略，嵌套递归比较；值位置可以放 `RegExp` 匹配该字段的字符串值）；顶层给 `RegExp` 匹配序列化后的完整输入；给谓词函数 `(input) => boolean` 拿原始值自行判断 |
| `count?: number` | 精确匹配调用次数；省略只要求「至少一次」 |
| `status?: "completed" \| "failed" \| "rejected"` | 只匹配处于该状态的调用 |

`calledSubagent` 的 `match` 是 `SubagentMatch`，语义同 `ToolMatch`：`{ count?: number; status?: "completed" | "failed"; remoteUrl?: string | RegExp }`，`remoteUrl` 只匹配指向该远程地址的子 Agent 委派。`event(type, opts?)` 的 `opts` 是 `{ count?: number }`，同样是精确次数。

```ts
t.calledTool("get_weather", { input: { city: "Brooklyn" }, count: 1 });
t.notCalledTool("bash", { input: { command: /npm i/ } }); // 值位置用 RegExp

// HITL 拒绝分支:被拒的工具调用状态是 rejected,不是 failed
const request = t.requireInputRequest({ optionIds: ["approve", "reject"] });
await t.respond({ request, optionId: "reject" });
t.calledTool("send_email", { status: "rejected" });
```

## 顺序与谓词

`toolOrder(names)` / `eventOrder(types)` 断言的是**子序**：目标项按给定相对顺序出现即通过，中间夹杂其它调用或事件不影响结果：

```ts
t.toolOrder(["read_file", "write_file"]);          // 先读后写;中间调了别的工具也通过
t.eventOrder(["action.called", "action.result"]);
```

规则超出既有词汇时，用 `eventsSatisfy(label, predicate)` 对作用域的整段事件流写谓词。`label` 必填、进报告名——谓词是词汇表里最不透明的断言，没有名字的失败在报告里读不懂；`predicate` 是 `(events: readonly StreamEvent[]) => boolean`：

```ts
t.eventsSatisfy("thinking 不超过 3 次", (events) =>
  events.filter((e) => e.type === "thinking").length <= 3,
);
```

## 接收者专属能力

| 接收者 | API | 原因 |
|---|---|---|
| `t` | `check`、`require`、`skip`、`log`、`group` | 记录或控制整个 attempt |
| `t` | `newSession()` | 只有主上下文创建额外 session |
| `t` | `sandbox.*` | Sandbox 是 attempt 资源 |
| turn | `outputEquals(value)`、`outputMatches(schema)` | 直接评价这一轮的 `turn.data` |

不要为了表面一致把这些能力下放给 session 或 turn。

各断言失败时在 show / view 里显示什么（含负断言的反例定位），见 [断言与 Turn 的展示](display.md)。
