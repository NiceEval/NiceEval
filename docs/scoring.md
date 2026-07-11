# Scoring —— 评分器与判定

评分把"一个 attempt 的结果"折叠成一个 **Verdict**。niceeval 有五类评分手段,它们产出统一的 `Assertion`(带名字、严重级、分数),最后由判定规则汇总。**这一篇只讲断言收集完之后怎么变成判定**;每类断言具体是什么、看哪一轮、来源哪里,查 [Assertions](assertions.md)。

五类(详情见 Assertions 对应小节):

1. **值级断言** —— `t.check` / `t.require` 配 `expect` 里的匹配器。`check` 同步记录并继续收集其它断言;`require` 立即等待 matcher 结果,作为前置条件失败中止。见 [Assertions · 值级断言](assertions.md#值级断言)。
2. **作用域断言** —— `t.succeeded()` / `t.calledTool()` 等,在 `test` 结束后对本次 eval run 聚合评估;同一套断言挂在 `session` 上看单条 session,挂在 `turn` 上只看这一轮。见 [Assertions · API 分组速查](assertions.md#api-分组速查)。
3. **LLM-as-judge** —— 用一个裁判模型给开放式回答打分,`t.judge` / `session.judge` 默认评对应 session,`turn.judge` 默认评当前 turn,细节见下文。
4. **测试即评分**(沙箱型) —— 手工在沙箱里跑测试与命令,把命令结果交给 `t.check`。
5. **效率 / 成本断言** —— `t.maxTokens()` / `t.maxCost()` 等,把 token 花费也变成可判的维度。见 [Assertions · 作用域断言共享词汇](assertions.md#作用域断言共享词汇)。

## 严重级:gate vs soft

每个断言有一档严重级,决定它如何影响判定(完整定义见 [Assertions · 严重级](assertions.md#严重级gate-vs-soft)):

- **gate** —— 硬性要求,不过 → 整个 eval `failed`,任何时候都生效。`includes` / `equals` 等默认 gate。
- **soft** —— 质量分,不会单独让 eval 立即 fail。`.atLeast(x)` 本身就是 soft 带阈值的写法:非 `--strict` 下低于 x 仍 `passed`(分数照样如实记录),`--strict` 下才改判 `failed`。不调 `.atLeast()` 也不调 `.gate()` 时,走匹配器自己的默认档:`similarity` 默认 soft、阈值 0.6;judge 默认 soft、没有阈值,纯记分,任何时候都不会 fail。

> 判定只有 **passed / failed / errored / skipped** 四态,没有 `scored` 中间态。"分数不够任何时候都要 fail" → 用 `.gate()`(或默认就是 gate 的匹配器);"分数不够只在 `--strict` 下才算 fail" → 用 `.atLeast(x)`;"只想记个分,永不影响判定" → 不调 `.atLeast()`,用默认走 soft、无阈值的匹配器(如裸的 judge 调用)。

这条规则横跨值级匹配器和 judge,行为一致:

```typescript
t.check(t.reply, includes("晴"));                     // 默认 gate
t.check(t.reply, similarity(expected).atLeast(0.8));  // soft + 阈值:非 --strict 只记分;--strict 下 < 0.8 才 fail
t.judge.autoevals.closedQA("礼貌");                   // 无阈值 = 默认 soft、纯分数(永不挂)
t.judge.autoevals.closedQA("礼貌").atLeast(0.7);      // soft + 阈值:--strict 下 < 0.7 才 fail
```

## 3. LLM-as-judge

用于"对不对靠规则说不清"的开放式回答。裁判模型与被测 agent **完全分离**,避免自评。

```typescript
t.judge.autoevals.factuality(expected).atLeast(0.8);      // 事实一致性
t.judge.autoevals.closedQA("是否适合 10 岁小孩理解");        // 闭合式判断
t.judge.autoevals.summarizes(source);                      // 是否忠实摘要

const turn = await t.send("解释一下量子隧穿。");
turn.judge.autoevals.closedQA("这一轮回答是否适合高中生理解");
```

`closedQA`/`factuality`/`summarizes` 挂在 `t.judge.autoevals.*`、`session.judge.autoevals.*` 和 `turn.judge.autoevals.*` 下,不留平铺别名。judge 就是这三个固定形状,评什么都落进 `closedQA`/`factuality`/`summarizes` 之一,材料也可以通过 `{ on }` 显式传。

`{ on }` 指定被评的值,`{ model }` 可单次覆盖裁判模型。默认材料由接收者决定:`t.judge` / `session.judge` 默认评对应 session 的对话文本;`turn.judge` 默认评这一轮的 `turn.message`。

> **judge 默认材料按接收者分层。** `t.judge` / `session.judge` 是 session 级,适合评当前会话的整体回答质量或跨轮一致性;`turn.judge` 是 turn 级,只评这一轮的 `turn.message`。要评 sandbox 产物/diff 或其它自定义材料,显式传 `{ on }`,例如 `t.judge.autoevals.closedQA("…", { on: t.sandbox.diff.get(path) }).atLeast(0.7)`。每条断言看哪一轮、各自来源,见 [Assertions](assertions.md)。

**模型解析优先级**(高 → 低):单次调用的 `{ model }` → 这个 eval 的 `judge.model` → 配置的 `judge.model` → 环境变量 `NICEEVAL_JUDGE_MODEL`。**没有内置默认模型**:解析不到 model 而 eval 用到了 judge 断言,会报清晰错误(而不是静默打向某个写死的模型)。

```typescript
// niceeval.config.ts —— 全局默认
defineConfig({ judge: { model: "anthropic/claude-haiku-4-5" } });

// 某个 eval 覆盖
defineEval({ judge: { model: "anthropic/claude-opus-4-8" }, async test(t) { ... } });
```

## 4. 测试即评分(沙箱型)

沙箱型里,你在 `test(t)` 里手工跑的验证命令本身就是评分材料:调 `t.sandbox.runCommand(...)` 跑测试(vitest 或别的什么都行),再用 `t.check(result, commandSucceeded())` 断言退出码 0。命令执行和评分分开,不会再有 `scriptPassed()` / `testsPassed()` 这种既像执行又像断言的 API。

```typescript
import { commandSucceeded } from "niceeval/expect";

const test = await t.sandbox.runCommand("npm", ["test"]);
t.check(test, commandSucceeded());
```

这让你用熟悉的测试语法表达"什么算对",并能断言文件内容、构建结果、甚至 agent 行为(经 `__niceeval__/results.json`)。没有另一层"validation 模式"开关——跑不跑测试、跑什么测试,都是 `test(t)` 里的普通代码决定的。详见 [Authoring](eval-authoring.md#沙箱型手工把文件放进沙箱)。

## 5. 效率 / 成本断言

token 用量是评分的一等维度 —— agent 答对了但烧掉十倍 token,不该和省着用的拿一样的分。这把「质量」和「效率」拆成两组断言,跨 agent 对比时就能同时看通过率和花费。用量自动随结果带回(沙箱型从 transcript 抠,见 [Observability](observability.md#用量与成本token--计费));`maxTokens()` / `maxCost()` 是作用域断言词汇的一部分,挂在 `t` 上看整个 attempt,挂在 `session` 上看单条 session,挂在 `turn` 上看单轮。具体用法、默认严重级见 [Assertions · 作用域断言共享词汇](assertions.md#作用域断言共享词汇)。

## 判定规则

所有断言收齐后,运行器直接折叠成一个互斥的 **Verdict**——只有四态,没有中间的 `scored`(定义见 [Concepts · Verdict](concepts.md#评测核心词汇)):

```text
显式 t.skip(reason)                                     → skipped
执行出错(超时 / 异常 / 作者错误)                         → errored
任一 gate 断言不过,或 --strict 下有 soft 断言低于阈值    → failed
否则                                                     → passed
```

`failed` 只表示断言 / 评分不通过,`errored` 是环境、超时、adapter、agent runtime 等执行问题——两者互斥,`summary.failed` 与 `summary.errored` 分开计数。看报告、JUnit 或 CI 判红时按这个口径区分"agent 做错了"和"环境出问题了",不要混着看。

soft 断言(`.atLeast(x)`,或匹配器自己默认走 soft 档)不会单独造成 `failed`——除非开了 `--strict` 且它是带阈值的 `.atLeast(x)`。分数以 chip / 行尾徽章展示在每条 eval 详情里,供横向对比质量用。要让"分数不够"任何时候都 fail,用默认就是 gate 的匹配器,或显式 `.gate()`。

多次运行(`runs > 1`)时,eval 的汇总是**通过率**(pass 占比)与平均耗时,而非单一 Verdict。

## 自定义评分器

值级断言就是 `(value) => number | Promise<number>`,直接写:

```typescript
import { makeAssertion, type Assertion } from "niceeval/expect";

function jsonValid(): Assertion {
  return makeAssertion({
    name: "jsonValid",
    severity: "gate",
    score: (value) => { try { JSON.parse(String(value)); return 1; } catch { return 0; } },
  });
}

t.check(t.reply, jsonValid());
```

需要跨多次运行聚合的指标(如 pass@k、平均工具数),在 reporter 层做,见 [Observability](observability.md#reporters)。

## 相关阅读

- [Assertions](assertions.md) —— 每条断言做什么、看哪一轮、来源哪里(值级 / 作用域 / sandbox 结果 / 轮级的完整速查表)。
- [Authoring](eval-authoring.md) —— 断言出现在哪种 eval 里。
- [Observability](observability.md) —— transcript / o11y,作用域断言的数据来源。
- [Concepts](concepts.md) —— Severity / Verdict 的术语定义。
