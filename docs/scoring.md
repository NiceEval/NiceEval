# Scoring —— 评分器与判决

评分把"一次运行的结果"折叠成一个**判决**。fasteval 有五类评分手段,它们产出统一的 `Assertion`(带名字、严重级、分数),最后由判决规则汇总。**这一篇只讲断言收集完之后怎么变成判决**;每类断言具体是什么、看哪一轮、来源哪里,查 [Assertions](assertions.md)。

五类(详情见 Assertions 对应小节):

1. **值级断言** —— `t.check` / `t.require` 配 `expect` 里的匹配器,就地评估。见 [Assertions · 值级断言](assertions.md#值级断言tcheck--trequire--匹配器)。
2. **作用域断言** —— `t.succeeded()` / `t.calledTool()` 等,在 `test` 结束后对整次运行评估。见 [Assertions · 作用域断言](assertions.md#作用域断言t-上跑完后评估) / [工作区断言](assertions.md#工作区断言tsandbox仅-workspace-能力)。
3. **LLM-as-judge** —— 用一个评判模型给开放式回答打分,细节见下文。
4. **测试即评分**(沙箱型) —— 跑 `EVAL.ts` 与 npm scripts,通过/失败即分数。
5. **效率 / 成本断言** —— `t.maxTokens()` / `t.maxCost()`,把 token 花费也变成可判的维度。见 [Assertions · 作用域断言](assertions.md#作用域断言t-上跑完后评估)。

## 严重级:gate vs soft

每个断言有一档严重级,决定它如何影响判决(完整定义见 [Assertions · 严重级](assertions.md#严重级gate-vs-soft)):

- **gate** —— 硬性要求,不过 → 整个 eval `failed`。**写了阈值的 `.atLeast(x)` 也是 gate**。
- **soft** —— 只记录、不影响判决的质量分,**永远不会**把 eval 判成 failed。用 `.soft(threshold)` 显式声明,或 judge / similarity **不带阈值**时的默认。

> 判决只有 **pass / fail / errored / skipped**,没有 `scored` 中间态。"分数不够就 fail" → 用 `.atLeast(x)`(gate);"只想记个分别挂" → 用 `.soft()`。

这条规则横跨值级匹配器和 judge,行为一致:

```typescript
t.check(t.reply, includes("晴"));                     // 默认 gate
t.check(t.reply, similarity(expected).atLeast(0.8));  // 阈值即硬 gate:< 0.8 就 fail
t.check(t.reply, similarity(expected).soft(0.8));     // 只记分,不挂
t.judge.autoevals.closedQA("礼貌");                   // 无阈值 = soft 纯分数(永不挂)
t.judge.autoevals.closedQA("礼貌").atLeast(0.7);      // 阈值 = 硬 gate:< 0.7 就 fail
```

## 3. LLM-as-judge

用于"对不对靠规则说不清"的开放式回答。评判模型与被测 agent **完全分离**,避免自评。

```typescript
t.judge.autoevals.factuality(expected).atLeast(0.8);      // 事实一致性
t.judge.autoevals.closedQA("是否适合 10 岁小孩理解");        // 闭合式判断
t.judge.autoevals.summarizes(source);                      // 是否忠实摘要
t.judge.score("自定义评分标准的一段话", { on: t.reply });
```

`closedQA`/`factuality`/`summarizes` 只挂在 `t.judge.autoevals.*` 下,不留平铺别名(跟 eve 一致,见 [Assertions · LLM-as-judge](assertions.md#llm-as-judge));`t.judge.score` 是 fasteval 自己加的开放式评分,不属于 autoevals,不用套这层命名空间。

`{ on }` 指定被评的值(默认 `t.reply`),`{ model }` 可单次覆盖评判模型。

> **judge 默认只看最后一轮。** `t.reply` 是最后一条 assistant 消息,所以多轮里直接 `t.judge.score("整段对话是否…")` 只会拿到最后一轮、证据不足。要评跨轮一致性,把整段对话拼出来传进去:`t.judge.score("…", { on: t.transcript.text() }).atLeast(0.7)`。(评工作区产物/diff 用沙箱型的 `t.sandbox.judge`。)每条断言看哪一轮、各自来源,见 [Assertions](assertions.md)(尤其[作用域:三层](assertions.md#作用域三层看哪一轮))。

**模型解析优先级**(高 → 低):单次调用的 `{ model }` → 这个 eval 的 `judge.model` → 配置的 `judge.model`。

```typescript
// fasteval.config.ts —— 全局默认
defineConfig({ judge: { model: "anthropic/claude-haiku-4-5" } });

// 某个 eval 覆盖
defineEval({ judge: { model: "anthropic/claude-opus-4-8" }, async test(t) { ... } });
```

## 4. 测试即评分(沙箱型)

沙箱型里,跑 `EVAL.ts`(Vitest)本身就是评分:每个 `test()` 是一条 gate 断言。这让你用熟悉的测试语法表达"什么算对",并能断言文件内容、构建结果、甚至 agent 行为(经 `__fasteval__/results.json`)。详见 [Authoring](eval-authoring.md#沙箱型fixture)。

`validation` 模式控制跑什么:`vitest`(跑 `EVAL.ts` + scripts)或 `none`(只跑 scripts)。

## 5. 效率 / 成本断言

token 用量是评分的一等维度 —— agent 答对了但烧掉十倍 token,不该和省着用的拿一样的分。这把「质量」和「效率」拆成两组断言,跨 agent 对比时就能同时看通过率和花费。用量自动随结果带回(沙箱型从 transcript 抠,见 [Observability](observability.md#用量与成本token--计费));`t.maxTokens()` / `t.maxCost()` 具体用法、默认严重级见 [Assertions · 作用域断言](assertions.md#作用域断言t-上跑完后评估),`t.usage` 字段见 [Assertions · 逃生舱](assertions.md#逃生舱原始事件流--派生数据)。

## 判决规则

所有断言收齐后,`verdict.ts` 先按评分语义折叠 `verdict`:

```text
执行出错(超时/异常/作者错误)              → failed
任一 gate 断言不过                          → failed
显式 t.skip(reason)                         → skipped
否则                                        → passed   (soft 断言失败不影响这里)
```

报告和 CI 还会给每条结果写入互斥的 `outcome`:

```text
无执行错误且 verdict=passed                 → passed
无执行错误且 verdict=failed                 → failed   (断言不通过)
有执行错误                                  → errored  (环境、超时、adapter、agent runtime)
verdict=skipped                             → skipped
```

因此 `summary.failed` 只数真·不通过,`summary.errored` 单独数执行/环境问题。

### 用户视角:只有三个出口状态

对 eval 结果而言,真正重要的出口只有三个:

| 显示状态 | 含义 | 对应 outcome/verdict |
|----------|------|----------------------|
| **pass** | gate 全过(soft 断言无论高低都不影响) | `passed` |
| **fail** | 至少一个 gate 不通过 | `failed` |
| **error** | 执行/环境层错误(超时、crash 等) | `errored` |

soft 断言只产出一个分数,**永远不会**让 eval failed;它的分数以 chip / 行尾徽章展示在每条 eval 详情里,供横向对比质量用。要让"分数不够"真的 fail,就用 `.atLeast(x)`(它是 gate)。

多次运行(`runs > 1`)时,eval 的汇总是**通过率**(pass 占比)与平均耗时,而非单一判决。

## 自定义评分器

值级断言就是 `(value) => number | Promise<number>`,直接写:

```typescript
import { makeAssertion } from "fasteval/expect";

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

- [Assertions](assertions.md) —— 每条断言做什么、看哪一轮、来源哪里(值级 / 作用域 / 工作区 / 轮级的完整速查表)。
- [Authoring](eval-authoring.md) —— 断言出现在哪种 eval 里。
- [Observability](observability.md) —— transcript / o11y,作用域断言的数据来源。
- [Concepts](concepts.md) —— Severity / Verdict 的术语定义。
