# 计分并设置质量门

## 用户目标

评估作者要按回答说对了几项事实计分，同时要求回答达到质量门；未通过时也要保留已得到的分数。

## 起始状态

已有选择 Agent 的 Experiment `support`，可以运行 Score Eval。
应用提供查询当前发布状态的公开接口：当前版本 `v42`，上一个版本 `v41`，失败的检查 `payments-health`。
本例的 rubric 为指出出问题的版本 2 分、说对回退目标与失败检查 8 分，再加作者显式声明的 1 分。
本页未调用 Agent；表中的 measurement 与分数都是按给定回答计算的预期输出。

## 完整路径

1. 在 Eval 目录保存 `answer-score.ts`，用确定性 Match 计算两项事实的命中比例，再配置分值与质量门。 {#author}

   ```ts
   import { defineScoreEval } from "niceeval";
   import { defineScoreMatch, includes } from "niceeval/expect";
   import { currentRelease } from "../src/release-client";

   const coverage = defineScoreMatch({
     name: "answer-coverage",
     score: (input: { reply: string; facts: readonly string[] }) =>
       input.facts.filter((fact) => input.reply.includes(fact)).length / input.facts.length,
   });

   export default defineScoreEval({
     description: "线上报错时说对出问题的版本、回退目标和失败的检查",
     async test(t) {
       const turn = await t.send("刚上线的版本让支付一直报错，现在该怎么办？");
       const release = await currentRelease();

       t.check(turn.reply, includes(release.current))
         .score(2)
         .label("指出出问题的版本");
       t.check({ reply: turn.reply, facts: [release.previous, release.failingCheck] }, coverage)
         .score(8)
         .gate(0.75)
         .label("回退目标与失败检查");
       t.score(1).label("基础分");
     },
   });
   ```

   题面没有出现任何版本号或检查名；三项事实都从应用的公开接口读出，回复要查过才说得对（[T-27](../../../taste.md#t-27)）。

   预期输出：事实检查只求值一次，同一个结果同时用于计分和质量门。
   版本检查贡献分数，但没有质量门；低分本身不会使此项成为失败条件。

2. 执行 Eval，分别观察 earned score 与 Verdict。 {#run}

   ```sh
   niceeval exp support answer-score
   ```

   | 给定回答 | 预期输出 |
   |---|---|
   | `v42 的 payments-health 检查失败，建议回退到 v41。` | measurement 为 1，earned 为 11，完整度为 complete，Verdict 为 `passed`。 |
   | `v42 有问题，建议回退到 v41。` | measurement 为 0.5，earned 为 7，完整度为 complete，质量门不满足，Verdict 为 `failed`。 |
   | `payments-health 检查失败，建议回退到 v41。` | 版本项贡献 0，earned 为 9；质量门满足，Verdict 为 `passed`。 |

## 结果

回答说对的事实比例形成连续分数，质量门单独决定它是否满足验收下限。
质量门失败保留 earned score；完整分数也不会把失败的 Attempt 变成成功排名结果。

## 相关契约

- [Score Eval](../library/score-points.md)：contribution、直接分数、完整度与 Verdict。
- [自定义连续 Match](../library/custom-assertions.md#连续-evaluator)：measurement 与一次求值。
- [handle 配置](../library/README.md#handle-配置)：同一 entry 的 `.score` 与 `.gate`。
- [Experiment CLI](../../experiments/cli/README.md#命令)：执行入口。
