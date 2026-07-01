# 宽泛 OR 正则 gate + soft judge 叠加,会把明确失败悄悄判成 passed

**现象**：`examples/zh/ai-sdk/evals/image-understanding.eval.ts` 跑 deepseek-v4-pro 时,模型明确回复"不支持图像输入,无法查看你发送的图片",fasteval view 里这条 eval 仍显示"通过"(绿行);展开断言明细能看到 `judge:autoevals:closedQA` 确实判了 0/0.7、标着"失败",但整条 outcome 还是 passed。

**根因**：两个问题叠加。(1) `t.messageIncludes(/蓝|blue|白|方块|图片|颜色/i)` 是默认 gate 断言,但正则里混进了"图片"/"颜色"这种过泛的词——连模型的拒绝语本身("无法查看你发送的**图片**")都能命中,gate 断言假阳性通过。(2) 真正能识别出"答非所问"的 `t.judge.autoevals.closedQA(...).atLeast(0.7)` 判 0 分,但 `.atLeast()` 是 soft+阈值——非 `--strict` 下低于阈值仍是 `passed`(这是 `computeOutcome`/`docs/scoring.md` 文档化的既定设计,`--strict` 才会让它 fail;`src/scoring/verdict.ts` 没有 bug)。于是"模型是否真的理解图片内容"这个核心正确性信号,既没被 gate 卡住,也没被 judge 卡住。

**修法**：写 assertion 时留意——如果某个信号是"这个 eval 存在的意义"本身(不是锦上添花的质量分),就不要只用 soft/`.atLeast()`,要 `.gate(threshold)`。同时避免在 `messageIncludes` 的 OR 正则里塞太泛的词(尤其是题目/任务描述里本来就会出现的词,如"图片"、"颜色")——改成要求同时命中多个更具体的特征词(如同时要求 `/蓝|blue/` 和 `/白|方块|square/`),而不是任一宽泛关键词命中就算数,这样"答非所问但提到了同一批泛词"的假阳性就过不了 gate。

已修复：`examples/zh/ai-sdk/evals/image-understanding.eval.ts`(2026-07-01)。回归用例见 `test/e2e-image-refusal.test.ts` + `test/fixtures/image-refusal/`(mock agent 永远回复"拒绝识图",e2e 跑真实 CLI 断言 outcome 必须是 failed)。

注意：编辑 eval 源码不会重新给已经落盘的旧 `.fasteval/<run>/summary.json` 打分——`fasteval view` 打开的是历史工件快照,改完源码要重新真跑一遍(对着真实 agent 或至少 `--fresh`/`--force` 重跑)才能在 view 里看到修复生效,单看旧截图会误以为没修好。
