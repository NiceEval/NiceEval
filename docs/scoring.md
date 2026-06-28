# Scoring —— 评分器与判决

评分把"一次运行的结果"折叠成一个**判决**。fastevals 有五类评分手段,它们产出统一的 `Assertion`(带名字、严重级、分数),最后由判决规则汇总。

五类:

1. **值级断言** —— `t.check` / `t.require` 配 `expect` 里的匹配器,就地评估。
2. **作用域断言** —— `t.succeeded()` / `t.calledTool()` 等,在 `test` 结束后对整次运行评估。
3. **LLM-as-judge** —— 用一个评判模型给开放式回答打分。
4. **测试即评分**(沙箱型) —— 跑 `EVAL.ts` 与 npm scripts,通过/失败即分数。
5. **效率 / 成本断言** —— `t.maxTokens()` / `t.maxCost()`,把 token 花费也变成可判的维度。

## 严重级:gate vs soft

每个断言有一档严重级,决定它如何影响判决:

- **gate** —— 硬性要求。不过 → 整个 eval `failed`。用于"必须成立"的事实。
- **soft** —— 带阈值的质量分。低于阈值 → 降级为 `scored`(不是直接挂),仅 `--strict` 下才算失败。用于 judge 这类有连续分数的判断。

匹配器自带合理默认(`includes`/`equals` 默认 gate,`similarity`/judge 默认 soft),可链式改写:

```typescript
t.check(t.reply, includes("晴"));            // 默认 gate
t.check(t.reply, similarity(expected).gate()); // 改成 gate
t.judge.closedQA("礼貌").atLeast(0.7);        // soft + 阈值 0.7
```

## 1. 值级断言(`expect`)

`t.check(value, assertion)` 就地评估并记录;`t.require(value, assertion)` 在不过时**立刻抛出**、中止后续(适合前置条件)。

`fastevals/expect` 提供的匹配器:

```typescript
import {
  includes,     // 子串或正则命中            (默认 gate)
  equals,       // 深度相等                  (默认 gate)
  matches,      // Standard Schema(Zod 等)校验 (默认 gate)
  similarity,   // 归一化 Levenshtein 0–1    (默认 soft)
  satisfies,    // 自定义谓词 + 标签          (默认 gate)
} from "fastevals/expect";

t.check(turn.data, matches(z.object({ intent: z.enum(["refund", "ship"]) })));
t.check(t.reply, similarity("预期答案").atLeast(0.8));
t.check(turn.data, satisfies((d) => d.total > 0, "total 为正"));
```

匹配器是纯函数,`(value) => number`,易于自定义。

## 2. 作用域断言

这些在 `test` 跑完后,对整次运行评估(延迟评估,避免和 `t.send` 抢时序)。它们只在 Agent 声明了相应能力时才出现在 `t` 上。**全部读自[标准事件流](agents-and-adapters.md#标准事件流adapter-的核心难点)与其[派生事实](agents-and-adapters.md#派生事实core-算共享agent-无关)** —— 只要 adapter 产出了标准 `events`,这套断言对任何 agent 都成立。

**运行 / 会话维度:**

```typescript
t.succeeded();                       // 运行未失败,且没卡在未回答的人机交互(HITL)上
t.parked();                          // 干净地停在 HITL 输入上(最后一个事件是 input.requested)
t.messageIncludes("此致");            // 所有 message 事件拼接文本包含(字符串 / 正则)
```

**工具 / 动作维度(读 `deriveRunFacts` 的 toolCalls / subagentCalls):**

```typescript
t.calledTool("bash", { input: { command: /^pwd/ }, count: 1 });
t.notCalledTool("shell", { input: { command: /npm i/ } });  // 也接同一套匹配小语言
t.toolOrder(["read_file", "write_file"]);   // 工具调用的相对顺序
t.usedNoTools();                     // 比如:打招呼不该调工具
t.maxToolCalls(5);
t.loadedSkill("memory-v2");          // 语法糖 = calledTool("load_skill", { input: { skill } })
t.calledSubagent("researcher", { remoteUrl: /api\.example/ });  // 子 agent 委派
t.noFailedActions();                 // 工具 / 子 agent / 技能都没有 failed
```

工具匹配支持一套小语言(部分深度匹配):`input` 可以是字面量(深度部分匹配)、正则(对序列化串)、或谓词函数;`count` 精确计数,`status` 过滤调用状态。`calledTool` 与 `notCalledTool` 共用这套。

**事件流维度(底层逃生舱,直接查 `events`):**

```typescript
t.event("input.requested", { count: 1 });           // 某类型事件出现(可带数据 / 计数匹配)
t.notEvent("error");                                 // 某类型事件没出现
t.eventOrder(["action.called", "subagent.called"]);  // 事件分组按顺序出现
t.eventsSatisfy("先读后写", (events) => /* 自定义谓词 */ true);
```

前面那些都是这层的语法糖;规则覆盖不到的奇怪断言,直接落到 `events` 上自己写。

**结构化输出(在 `turn` 上,而非 `t`):**

```typescript
const turn = await t.send("返回 JSON");
turn.outputEquals({ status: "ok" });                  // turn.data 深度相等
turn.outputMatches(z.object({ status: z.string() })); // Standard Schema 校验
```

**沙箱 / 工作区维度(沙箱型 Agent):**

```typescript
t.fileChanged("src/Button.tsx");
t.fileDeleted("src/old.ts");
t.diff.isEmpty();                    // 这一轮没动任何仓库文件
t.notInDiff(/sk-[A-Za-z0-9]/);       // 改动里不含某模式(密钥、内联 style…)
t.testsPassed();                     // EVAL.ts 全绿
t.scriptPassed("build");             // npm run build 退出 0
t.noFailedShellCommands();
```

`t.diff` 是可查询对象:`t.diff.get(path)`(取某文件改后内容)、`t.diff.isEmpty()`、`t.diff.matches(re)` / `t.notInDiff(re)`(对全部改动正则匹配)。

## 3. LLM-as-judge

用于"对不对靠规则说不清"的开放式回答。评判模型与被测 agent **完全分离**,避免自评。

```typescript
t.judge.factuality(expected).atLeast(0.8);      // 事实一致性
t.judge.closedQA("是否适合 10 岁小孩理解");        // 闭合式判断
t.judge.summarizes(source);                      // 是否忠实摘要
t.judge.score("自定义评分标准的一段话", { on: t.reply });
```

`{ on }` 指定被评的值(默认 `t.reply`),`{ model }` 可单次覆盖评判模型。

**模型解析优先级**(高 → 低):单次调用的 `{ model }` → 这个 eval 的 `judge.model` → 配置的 `judge.model`。

```typescript
// fastevals.config.ts —— 全局默认
defineConfig({ judge: { model: "anthropic/claude-haiku-4-5" } });

// 某个 eval 覆盖
defineEval({ judge: { model: "anthropic/claude-opus-4-8" }, async test(t) { ... } });
```

## 4. 测试即评分(沙箱型)

沙箱型里,跑 `EVAL.ts`(Vitest)本身就是评分:每个 `test()` 是一条 gate 断言。这让你用熟悉的测试语法表达"什么算对",并能断言文件内容、构建结果、甚至 agent 行为(经 `__fastevals__/results.json`)。详见 [Authoring](authoring.md#沙箱型fixture)。

`validation` 模式控制跑什么:`vitest`(跑 `EVAL.ts` + scripts)或 `none`(只跑 scripts)。

## 5. 效率 / 成本断言

token 用量是评分的一等维度 —— agent 答对了但烧掉十倍 token,不该和省着用的拿一样的分。用量自动随结果带回(沙箱型从 transcript 抠,见 [Observability](observability.md#用量与成本token--计费)),可直接断言:

```typescript
t.maxTokens(50_000);            // 整次运行 token 上限,超了判 failed(默认 gate)
t.maxCost(0.5);                 // 估算成本上限($),需配价格表
t.maxTokens(80_000).soft();    // 也可降级为 soft,只在 --strict 下红
t.check(t.usage.outputTokens, satisfies((n) => n < 10_000, "输出不啰嗦"));
```

`t.usage`(`{ inputTokens, outputTokens, cacheReadTokens?, … }`)在 `test` 里随时可读。这把「质量」和「效率」拆成两组断言,跨 agent 对比时就能同时看通过率和花费。

## 判决规则

所有断言收齐后,`verdict.ts` 按这个顺序折叠:

```text
执行出错(超时/异常/作者错误)              → failed
任一 gate 断言不过                          → failed
显式 t.skip(reason)                         → skipped
gate 全过,但有 soft 低于阈值                → scored   (仅 --strict 下算失败)
否则                                        → passed
```

- `passed`:无错,gate 全过,soft 全达标。
- `failed`:执行错误**或** gate 挂。
- `scored`:gate 都过,但有 soft 没到阈值 —— 这是"能用但有质量回归"的信号,平时不红、`--strict` 下红。
- `skipped`:`t.skip("理由")` 被调用(比如缺前置条件)。

多次运行(`runs > 1`)时,eval 的汇总是**通过率**(passed 占比)与平均耗时,而非单一判决。

## 自定义评分器

值级断言就是 `(value) => number | Promise<number>`,直接写:

```typescript
import { makeAssertion } from "fastevals/expect";

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

- [Authoring](authoring.md) —— 断言出现在哪种 eval 里。
- [Observability](observability.md) —— transcript / o11y,作用域断言的数据来源。
- [Concepts](concepts.md) —— Severity / Verdict 的术语定义。
