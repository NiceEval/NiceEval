# 把评估或实验文件移到子目录

退款相关的题多了，想把 `evals/refund.eval.ts` 收进 `evals/payments/`。题目和判分都没改，希望下次跑实验时继续用上次的结果。

1. 这道题原来的 ID 是 `refund`。在文件顶部加一行 `export const id = "refund";`，这样换了位置也认得出是同一道题。 {#keep-id}
2. 把文件移到 `evals/payments/refund.eval.ts`。也可以顺便把文件名改成 `refund-policy.eval.ts`。如果里面有相对导入，把它改到仍能找到原文件。 {#move-file}
3. 假设原来用 `base` 实验跑这道题，执行 `niceeval exp base refund --dry`。如果上次的结果可用，预览会显示沿用，无需再跑一次。 {#preview}

实验文件也一样。例如，要把 `experiments/base.ts` 移到 `experiments/payments/base.ts`，就在文件顶部写 `export const id = "base";`。移动后仍用 `niceeval exp base --dry` 查看。

如果文件里已经声明了 ID，保留那一行就行。如果顺手改了题目或判分规则，这道题会重新跑。
