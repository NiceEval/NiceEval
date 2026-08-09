# 过程与成本：断 agent 怎么做到的

## 解决什么问题

结果对了不等于过程对了：agent 可能翻了不该翻的原始数据、绕过了该走的工具、烧了十倍的 token。
作用域断言的过程词汇把「怎么做到的」也变成可评分的条目。
一条调用的全部可断面——**入参、次数、输出、状态——都在 `match` 对象一处表达**；严重度（这条条目影不影响判定）用 `.gate(x?)` / `.atLeast(x)` / `.soft()` 正交声明。

## 全流程

1. 用 `calledTool` 的匹配小语言断关键动作。
   `input` 深度部分匹配（值位置放 RegExp 或谓词）；`count` 数字＝恰好、谓词＝自定，省略＝至少一次；`output` 断这次调用的返回；`status` 过滤调用状态（[字段全集](../../assertions/library/scoped-assertions.md#匹配条件的字段全集)）：

   ```typescript
   t.calledTool("shell", { input: { command: /\bniceeval\s+exp\b/ } });    // 至少跑过一次 exp
   t.calledTool("shell", { input: { command: /\bniceeval\s+init\b/ }, count: 1 });  // 恰好一次
   t.calledTool("file_read", { count: (n) => n >= 2 });                    // 至少读了两次
   t.calledTool("shell", { input: { command: /curl/ }, output: /tutorials\// });    // 入参与输出一起断
   ```

2. 反作弊用负断言，不用手挖事件流——「没做某事」和「做了某事」是同一套词汇：

   ```typescript
   t.notCalledTool("shell", { input: { command: /\.niceeval\/.*\.json/ } });  // 不许徒手翻原始产物
   ```

3. 断顺序用 `toolOrder` / `eventOrder`——它们断的是**子序**，中间夹杂其它调用不影响：

   ```typescript
   t.toolOrder(["read_file", "write_file"]);   // 先读后写
   ```

4. 成本与纪律上限：`maxToolCalls(n)` / `maxTokens(n)` / `maxCost(usd)` 封顶，`noFailedActions()` 断没有失败的工具或子 agent 动作，`usedNoTools()` 断纯文本作答。
   词汇涵盖不到的规则才用 `eventsSatisfy(label, predicate)` 写谓词，`label` 必填、进报告名。

5. 用 `t.group` 组织报告区块，用严重度声明每条的分量。**
   作用域断言默认就是 gate**——失败就红，什么都不用链；还没定案的指标链 `.atLeast(1)` 降成软指标——失败照实记 failed，但默认不拖垮判定，`--strict` 下才计入；只想记分布、连 failed 都不想标的用无参 `.soft()`：

   ```typescript
   await t.group("命令调用链", async () => {
     t.calledTool("shell", { input: { command: /\bniceeval\s+exp\b(?![\s\S]*--dry)/ } });
     t.calledTool("shell", { input: { command: /\bniceeval\s+show\b/ } });
     t.notCalledTool("shell", { input: { command: /\.niceeval\/.*\.json/ } });
   });

   await t.group("路由层", async () => {
     t.calledTool("shell", { input: { command: INDEX_RE } }).atLeast(1);      // 软指标:失败记录,不 gate
     t.calledTool("shell", { input: { command: EXPECTED_PAGES } }).atLeast(1);
   });
   ```

`.optional()` 是另一个正交维度：允许这条断言在证据缺席时只形成 `unavailable` Assertion Claim、不再形成 `errored` Verdict Claim。

## 边界

- **次数语义全在 `count` 里**：数字恰好、谓词自定、省略至少一次。
  `.atLeast(x)` 的参数是**分数线**不是次数——`.atLeast(1)` 读作「这条断言至少及格」，不是「至少调用一次」；「至少调用 2 次」写 `{ count: (n) => n >= 2 }`（[裁决](../../verdict/architecture.md#severity)）。
- 负断言（`notCalledTool` / `notEvent`）和上限断言依赖完整证据：所需通道非 complete 时记 `unavailable`，不会按空证据静默通过；谓词 `count` 不满足时同理（[证据与完整性](../../assertions/architecture/evidence.md)）。
- 谓词（`count` 谓词、`eventsSatisfy`、`satisfies`）对报告不透明，失败时只有 label 和计数可读——能用字面量表达的不要写谓词。
- `output` 断的是工具返回给 agent 的内容，不是 agent 之后说了什么——断回复文本用 `messageIncludes` 或值断言。

## 相关阅读

- [作用域断言](../../assertions/library/scoped-assertions.md) —— 词汇全表与匹配条件的字段全集。
- [calledTool 匹配全参数](calledtool.md) —— `input` / `count` / `output` / `status` 每个字段每种形态的逐条用例。
- [Assertions · 计分粒度](../../assertions/library/score-points.md) —— 通过制一个 eval 一分，要按检查点挣分改用 `defineScoreEval`；`t.group` 的组名是跨 eval 的得分点维度，同类检查在不同 eval 里保持组名一致。
- [Severity 与 Verdict](../../verdict/architecture.md) —— `.gate(x?)` / `.atLeast(x)` / `.soft()` 的分工与折叠规则。
- [自定义断言](../../assertions/library/custom-assertions.md) —— 词汇表不够用时的扩展方式。
