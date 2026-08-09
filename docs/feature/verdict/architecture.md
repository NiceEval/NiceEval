# Verdict 与 Severity

一条断言链上什么词，决定它失败怎样向上传播。
本篇是**判定面**的单源：两种题型各一段标注代码，每个词旁边写「失败会怎样」。
分数怎么算、每个词落到哪个读数见 [计分粒度](../assertions/library/score-points.md)，matcher 自带的通过线见 [值断言](../assertions/library/value-assertions.md#内置-matcher)。

## Severity

`defineEval` 的 `t` 上，严重度既可以链在 matcher 上，也可以链在作用域断言的句柄上。
不链词就用 matcher 自带的默认严重度。

```typescript
export default defineEval({
  async test(t) {
    await t.send("查一下布鲁克林今天的天气。");

    t.check(t.reply, includes("Brooklyn"));
    //  不链词 → 用 matcher 自带的严重度，includes 默认 gate：没命中 → 形成 `failed` Verdict Claim

    t.check(t.reply, similarity(expected).gate(0.8));
    //  .gate(x) → 硬要求：分数低于 0.8 → failed
    //  省略 x 用默认通过线 1，也就是 matcher 自身的及格线（0/1 断言即「命中」）

    t.check(t.reply, similarity(expected).atLeast(0.7));
    //  .atLeast(x) → 降级为带通过线的 soft：低于 0.7 照实形成 failed Assertion Claim，Verdict Claim 默认不动
    //  --strict 下这条线翻成 gate → failed
    //  x 是分数线：0/1 断言写 .atLeast(1)，打分断言写 .atLeast(0.7)

    t.calledTool("get_weather", { count: 2 }).atLeast(1);
    //  作用域断言默认 gate，降级同样链这三个词
    //  「至少调用 2 次」是匹配条件，写在 count 里，不写成严重度的参数

    t.judge.autoevals.closedQA("回答准不准？").optional();
    //  judge 的默认严重度是无线的 .soft()：分数如实落盘、永不 fail
    //  .soft() 无参数——要设线用 .atLeast(x)，不提供同义的 soft(x)
    //  .optional() 与上面三个词正交：它管证据允不允许缺席，不管判定怎么传播（见下）
  },
});
```

`.atLeast` 的参数是分数线，不是调用次数——次数与其余匹配条件都在 [`ToolMatch`](../assertions/library/scoped-assertions.md#匹配条件的字段全集) 里表达。

severity 只管**判定面**：它声明一条断言的失败怎么向上传播，同一语义沿组、eval、experiment 逐层作用，不按层另设规则。
`--strict` 是作用于所有层的同一个旋钮——它把带线 soft 翻成 gate，只改判定传播，分数照记。
质量分（soft 断言的均值）与分数面（计分制的给分）是另外两个读数，折叠规则见[计分粒度](../assertions/library/score-points.md#折叠树判定面分数面质量分)。

## 控制流与严重度正交

`.gate()` 在 `defineEval` 与 `defineScoreEval` 中始终表示同一件事：断言不通过使该 Attempt 形成 `failed` Verdict Claim；它不写 Attempt lifecycle。
它不改变 `test()` 控制流。
后续代码依赖这条断言时，显式链 `.stopOnFailure()`；值断言可用两种题型都有的 `t.require()` 简写。

```typescript
export default defineScoreEval({
  async test(t) {
    await t.send("把 DB-GPT 装起来并通过健康检查。");

    await t.require(await t.sandbox.pathExists("db-gpt/README.md"), isTrue());
    //  等价于 t.check(...).gate().stopOnFailure()：记硬失败，并停止依赖它的后续代码

    t.sandbox.fileChanged("db-gpt/.env").points(1);
    //  .points(n) = 得分点：通过挣 n 分、不过挣 0 分，继续往下跑

    await t.calledTool("shell", { input: { command: /pip install/ } })
      .points(1).gate().stopOnFailure();
    //  得分点兼硬要求：丢 1 分、形成 `failed` Verdict Claim，并停止后续代码

    t.judge.autoevals.closedQA("说明讲清动机没有？").atLeast(0.6);
    //  .atLeast(x) = soft 通过线；低于线如实记 failed，--strict 下升级为 gate

    t.check(t.reply, includes("healthy"));
    //  不链词 = 观测：进质量分；matcher 自带的通过线照常生效，没做到如实记 failed
    //  .soft() 再把这条线也去掉——纯记录一个分数、永不 failed
  },
});
```

`.stopOnFailure()` 在写下的位置立即结算断言；通过时返回原值或句柄，失败时登记既定 Assertion Claim 并中止 `test()`。
它不能单独出现，必须跟在带通过线的 `.gate()` / `.atLeast()` 或使用 matcher 默认通过线的断言之后。
`.gate().stopOnFailure()` 是硬前置；`.atLeast(x).stopOnFailure()` 只停止后续代码，仍保持 soft 严重度。
控制流不再借 severity 一词表达。

`--strict` 对两种题型同义：带线 soft 升级为 gate，但不自行添加 `.stopOnFailure()`。

## Verdict

Verdict Claim 只有 passed、failed、errored、skipped，按固定优先级取第一个成立项；它从不改变 Attempt 的 `active` / `completed` / `abandoned` lifecycle：

```text
执行异常、超时、作者错误的 Observation，或任一非 optional 断言 unavailable Claim → `errored` Verdict Claim
任一 gate 不通过，或 strict 下任一 soft 不通过                              → `failed` Verdict Claim
显式 t.skip(reason)                                                             → `skipped` Verdict Claim
否则                                                                            → `passed` Verdict Claim
```

Errored 压过一切，因为执行证据已经不可信。
Failed 压过 skipped，避免 `t.skip()` 掩盖此前登记的硬失败。

计分制（`defineScoreEval`）使用同一张表。
得分点丢分本身不产生 `failed` Verdict Claim；显式 gate 不通过仍产生该 Claim。
`.stopOnFailure()` 只决定是否继续执行，不新增第五种 Verdict Claim。

## Durable Verdict Claim

Verdict 是 Attempt-scoped durable Claim。它的完整容器、catalog 和 strong edge 规则由
[Record Architecture](../record/architecture.md#provenanceclaim-evidencetarget-与归档) 定义；本节冻结
Verdict 专属字段，不能由 Runner、Report 或 Projector 改写。

```ts
type VerdictValueV1 = {
  readonly verdict: "passed" | "failed" | "errored" | "skipped";
  readonly strict: boolean;
};

interface VerdictClaimIdPreimageV1 {
  readonly schema: "niceeval.verdict-claim-id/1";
  readonly attempt: NodeRefV1;
}

interface DurableVerdictClaimV1 {
  readonly scope: { readonly kind: "attempt"; readonly attemptId: AttemptId };
  readonly claim: {
    readonly id: DigestV1;
    readonly kind: "verdict";
    readonly schema: "niceeval.verdict/1";
    readonly value: VerdictValueV1;
    readonly evaluator: {
      readonly namespace: "niceeval";
      readonly name: "verdict";
      readonly version: "1";
    };
    readonly basedOn: readonly EvidenceTarget[];
    readonly producedAt: string;
  };
}
```

`value` 恰为 `{ verdict, strict }`，没有其它字段。`evaluator` 恰为所示三个字段，没有 `model`
或其它字段。它的 exact identifier 是 `niceeval/verdict/1`，不是一个可配置的 Judge 或模型调用。

claim id 的 preimage 恰为 `{ schema: "niceeval.verdict-claim-id/1", attempt: NodeRefV1 }`。
对这个完整对象做 RFC 8785 JCS、无 BOM UTF-8 编码并计算 SHA-256。
结果编码唯一为 `sha256:` 加 64 个小写十六进制字符。不能拼 attemptId、locator、recordId、当前 head 或文本字段，
也不能协商摘要算法。

`basedOn` 有且只有一个 Verdict anchor：它是 `kind: "object"`、省略 `selector`、并且 `node` 与此
Attempt revision 的 object node 完全相同的 target。该 target 的 `niceeval.claim-basis-object` strong edge
必须存在并逐项指向同一个 node。其它 basis 可以说明执行错误或断言，但不能替代、复制或模糊这个 anchor。

full verifier 对 strong closure 中每个可投影的 Attempt revision 执行此检查。
范围包括 catalog 当前项、RunContribution adopted 项和 history 里的 revision。

它以该 revision 的 NodeRef 导出 Claim catalog key。Attempt 仍为 `active` 时，key 必须有 authenticated nonmembership。
Attempt 为 terminal 时，key 必须有 exact membership，且 membership 指向这份 exact Claim。
catalog occupancy、scope/attempt identity、id、evaluator、value、anchor 或 strong edge 任一不符都是 `verdict-claim-invalid`。

## 内建 Verdict Projector

`builtins.verdict` 是固定的 Attempt Projector。它的 id 为 `niceeval/verdict/1`，即
`{ namespace: "niceeval", name: "verdict", version: "1" }`。parameter schema 固定为
`niceeval.verdict-projector-parameters/1`，defaults 固定为 `{}`，normalization 只接受空对象。
它的唯一输出形状是 `{ verdict, strict }`，没有附加字段。

Projector 从 framework-owned adopted Attempt revision 导出 Verdict Claim id，再只调用
`ProjectionReadContext.claimById()` 这个 exact Claim catalog lookup primitive。primitive 自动 trace
membership 或 authenticated nonmembership，以及读到的 Claim object；Projector 不直接接触 Store、backend、
raw object、catalog page 或 registry callback。

strong closure 或 Verdict Claim node 损坏形成 `RecordReadError` 的 `record-graph-invalid`，它穿过
Projector framework，不改写为 unavailable 或 `ProjectorExecutionError`。若 Claim value 与 Verdict anchor
可读，但其余 basis 无法完整复核，Projector 返回 available value 和 `verification: "unverified"`；只有
value 或 anchor 本身不可读时才没有 Verdict value。

## 证据不可用（unavailable）不折叠成通过

一条断言评不了和它通过、失败都是两回事。
以下情况形成该条 `outcome: "unavailable"` 的 Assertion Claim（带机器可读 `reason`），绝不静默丢弃、绝不按空证据判通过：

- **负断言与上限断言的证据通道不完整**——`notEvent` / `usedNoTools` 这类「确认没发生」的断言，以及 token / cost 上限断言，都依赖完整采集。
  所需通道非 complete 时，空流不能证明「没发生」，缺 usage 不能按零聚合；unknown 也属于这种情况，见 [证据与完整性](../assertions/architecture/evidence.md)。
- **正断言在非 complete 通道上没找到匹配**——「没采到」不能算成「Agent 没做」；找到匹配则照常通过（证据存在就是证据），complete 通道上没找到才是 failed。
- **judge 没有找到模型或 API key**——rubric 写了就必须留下条目（见 [LLM-as-judge](../judge/library.md)）。
- **judge 调用没有产出可信分数**——请求发出去了但失败（HTTP 非 2xx、连接中断、单次调用超时），或响应回来了但取不出分数（不合协议、分数缺失或无法解读）。
  判分请求失败与 agent 没做到在分数面上必须可分辨：**这种情况绝不落成 `score: 0` 的通过条目**，否则「裁判失败」和「答得一塌糊涂」在报告里长得一模一样，而前者是要修配置、后者是要修 agent。
  `reason` 用 `judge-call-failed`，状态码或异常摘要进 `evidence`。

折叠规则只有一条：**作者写下的每条断言默认都要求可评估**。

- 任一非 optional Assertion Claim 为 unavailable，就形成 `errored` Verdict Claim，不分 gate / soft。
- Attempt lifecycle 仍只收束到 `completed` 或 `abandoned`。
- 评不了的判定不可信，不能当 agent 答对，也不该当 agent 答错。
  「soft 全部评不了但 attempt 还绿着」是没有测量的绿，不允许出现。
- 确实允许缺席的断言由作者显式链 `.optional()`。
  它的 unavailable 只保留在条目里由报告如实展示，不影响 Verdict。
- optional 与 severity 正交：severity 说「影不影响质量判定」，optional 说「证据允许不允许缺席」，不互相复用。

Turn failed 和 Attempt 的 `errored` Verdict Claim 不是同一概念：Agent 行为失败可以形成可评分结果；基础设施、超时或作者异常 Observation 使本次执行无法形成可信判定。
