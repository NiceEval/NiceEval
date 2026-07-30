# calledTool 匹配全参数：每个字段每种形态怎么用

## 解决什么问题

`calledTool` / `notCalledTool` 的 `match` 对象是过程断言的核心表达面：入参、次数、输出、状态四个字段，每个字段又有多种取值形态。
契约单源是[匹配条件的字段全集](../../assertions/library/scoped-assertions.md#匹配条件的字段全集)；本篇按「想断什么」把每个字段的每种形态遍历一遍，一条意图一段写法——实现或修改这套 API 时，本篇就是行为核对清单。

统一语义先固定：**`match` 描述单条调用要同时满足的条件**（`input` / `output` / `status` 之间是 AND，作用在同一笔调用上），**`count` 数的是满足这些条件的调用笔数**。
不存在「一笔调用满足 input、另一笔满足 output」也算命中的读法。

## 只断发生过

省略 `match`＝至少一次匹配调用：

```typescript
t.calledTool("get_weather");                 // 调过就行,不管参数、次数、结果
```

## input：断入参的四种形态

1. **对象＝深度部分匹配**。
   写出的键值要求出现且相等，未写的键忽略，嵌套对象递归比较：

   ```typescript
   t.calledTool("get_weather", { input: { city: "Brooklyn" } });          // 顶层键
   t.calledTool("search", { input: { query: { filters: { lang: "zh" } } } }); // 嵌套键,其余字段随意
   ```

2. **值位置放 `RegExp`**＝匹配该字段的字符串值。
   断「命令长什么样」的主力写法：

   ```typescript
   t.calledTool("shell", { input: { command: /\bniceeval\s+exp\b/ } });
   ```

3. **顶层给 `RegExp`**＝对序列化后的完整输入测试。
   不关心字段结构、只关心「入参里出现过它」时用：

   ```typescript
   t.calledTool("http_request", { input: /api\.weather\.gov/ });
   ```

4. **谓词函数**＝拿原始入参自行判断。
   字面量与 RegExp 表达不了的结构条件才用（谓词对报告不透明，见边界）：

   ```typescript
   t.calledTool("write_files", { input: (input) => input.files.length <= 3 });
   ```

## count：断次数的三种形态

```typescript
t.calledTool("deploy");                            // 省略 = 至少一次
t.calledTool("deploy", { count: 1 });              // 数字 = 恰好一次(多一次也算失败)
t.calledTool("file_read", { count: (n) => n >= 2 }); // 谓词 = 自定,"至少两次"
t.calledTool("retry", { count: (n) => n <= 3 });   // "至多三次"也是 count 谓词
```

「次数」永远在 `count` 里表达，不在严重度句柄里——`.atLeast(1)` 的参数是**分数线**，读作「这条断言至少及格」（[裁决](../../verdict/architecture.md#severity)）。
全 attempt 的调用总量上限用 `maxToolCalls(n)`，不用 `count` 逐工具凑。

## output：断这笔调用返回了什么

值语义与 `input` 的值位置相同——`RegExp` 对字符串输出测试（非字符串先序列化）、对象深度部分匹配、谓词拿原始输出、其余值严格相等。
和 `input` 合写时断的是**同一笔调用**「用这个入参、得到这个输出」：

```typescript
t.calledTool("shell", { input: { command: /curl/ }, output: /tutorials\// });
t.calledTool("query_db", { output: { rows: [] } });        // 对象部分匹配
t.calledTool("fetch", { output: (o) => o.status === 200 }); // 谓词
```

`output` 断的是工具返回给 agent 的内容，不是 agent 之后说了什么——断回复文本用 `messageIncludes` 或值断言。

## status：断调用处于什么状态

四个取值，省略＝不过滤状态：

- `completed`：正常拿到结果。
- `failed`：工具执行报错。
  配 `noFailedActions()` 是两种粒度：后者断「全程零失败动作」，`status: "failed"` 断「这个工具失败过 / 没失败过」。
- `pending`：已发起、尚无结果——典型是 HITL 停在审批上的那一笔。
- `rejected`：HITL 被人工拒绝。
  **被拒不是 `failed`**，两个状态不互相包含。

```typescript
// HITL:发起后停在审批上,拒绝后状态翻成 rejected
const draft = await t.send("发布前要我确认。");
draft.calledTool("send_email", { status: "pending", count: 1 });
const request = t.requireInputRequest({ optionIds: ["approve", "reject"] });
await t.respond({ request, optionId: "reject" });
t.calledTool("send_email", { status: "rejected" });
t.notCalledTool("send_email", { status: "completed" });     // 拒了就不许真发出去

// 自愈路径:失败过、但最终恰好成功一次
t.calledTool("deploy", { status: "failed", count: (n) => n >= 1 }).soft(); // 只记录重试次数
t.calledTool("deploy", { status: "completed", count: 1 });
```

## notCalledTool：同一套 match 的反面

`notCalledTool(name, match?)` 的 `match` 语义完全同上，断「不存在满足条件的调用」。
match 越具体，禁令越窄：

```typescript
t.notCalledTool("shell");                                          // 完全不许用 shell
t.notCalledTool("shell", { input: { command: /\.niceeval\/.*\.json/ } }); // 只禁徒手翻原始产物
t.notCalledTool("send_email", { status: "completed" });            // 可以发起,不许发成
```

负断言依赖完整证据：所需通道非 complete 时记 `unavailable`，不按空证据静默通过（[证据与完整性](../../assertions/architecture/evidence.md)）。

## 边界

- **`count` 数字超出是确凿失败**：partial 通道只会少采不会多采，实测已超出的「恰好 n 次」不可能是采集造成的；`count` 谓词不满足时在非 complete 通道上记 `unavailable`——缺证据的计数没有可信判定。
- **谓词（`input` / `output` / `count` 谓词）对报告不透明**，失败时只有 label 和计数可读——能用字面量或 RegExp 表达的不要写谓词。
- 严重度与 match 正交：默认 gate，降软指标链 `.atLeast(1)`，只记录链 `.soft()`；证据允许缺席另链 `.optional()`。
- `calledSubagent(name, match?)` 的 `SubagentMatch` 语义同源（`count` / `status` / `output` 同义，另有 `remoteUrl` 匹配委派地址）；`event(type, opts?)` 只有 `count`。
  字段全集见[契约单源](../../assertions/library/scoped-assertions.md#匹配条件的字段全集)。

## 相关阅读

- [Assertions · 作用域断言](../../assertions/library/scoped-assertions.md) —— 词汇全表与匹配条件的字段全集（契约单源）。
- [过程与成本](process-and-cost.md) —— calledTool 在真实反作弊 / 成本纪律场景里的组合用法。
- [HITL 审批](hitl-approval.md) —— `pending` / `rejected` 状态所属的完整审批流。
