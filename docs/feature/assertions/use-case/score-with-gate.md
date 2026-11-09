# 计分并设置质量门

## 用户目标

评估作者要按回答命中的要点计分，同时要求回答达到质量门；未通过时也要保留已得到的分数。

## 起始状态

已有选择 Agent 的 Experiment `support`，可以运行 Score Eval。
本例的 rubric 为结构 2 分、要点命中 8 分，再加作者显式声明的 1 分。
本页未调用 Agent；表中的 measurement 与分数都是按给定回答计算的预期输出。

## 完整路径

1. 在 Eval 目录保存 `answer-score.ts`，用确定性 Match 计算两个要点的命中比例，再配置分值与质量门。 {#author}

   ```ts
   import { defineScoreEval } from "niceeval";
   import { defineScoreMatch, includes } from "niceeval/expect";

   const coverage = defineScoreMatch({
     name: "answer-coverage",
     score: (reply: string) =>
       ["验证", "回滚"].filter((item) => reply.includes(item)).length / 2,
   });

   export default defineScoreEval({
     description: "回答包含后续操作、验证和回滚",
     async test(t) {
       const turn = await t.send("给出下一步操作，并说明验证与回滚。");
       t.check(turn.reply, includes("下一步"))
         .score(2)
         .label("回答结构");
       t.check(turn.reply, coverage)
         .score(8)
         .gate(0.75)
         .label("要点覆盖");
       t.score(1).label("基础分");
     },
   });
   ```

   预期输出：要点检查只求值一次，同一个结果同时用于计分和质量门。
   结构检查贡献分数，但没有质量门；低分本身不会使此项成为失败条件。

2. 执行 Eval，分别观察 earned score 与 Verdict。 {#run}

   ```sh
   niceeval exp support answer-score
   ```

   | 给定回答 | 预期输出 |
   |---|---|
   | `下一步：验证部署并准备回滚。` | measurement 为 1，earned 为 11，完整度为 complete，Verdict 为 `passed`。 |
   | `下一步：验证部署。` | measurement 为 0.5，earned 为 7，完整度为 complete，质量门不满足，Verdict 为 `failed`。 |
   | `验证部署并准备回滚。` | 结构项贡献 0，earned 为 9；质量门满足，Verdict 为 `passed`。 |

## 结果

回答的要点命中比例形成连续分数，质量门单独决定它是否满足验收下限。
质量门失败保留 earned score；完整分数也不会把失败的 Attempt 变成成功排名结果。

## 相关契约

- [Score Eval](../library/score-points.md)：contribution、直接分数、完整度与 Verdict。
- [自定义连续 Match](../library/custom-assertions.md#连续-evaluator)：measurement 与一次求值。
- [handle 配置](../library/README.md#handle-配置)：同一 entry 的 `.score` 与 `.gate`。
- [Experiment CLI](../../experiments/cli/README.md#命令)：执行入口。
