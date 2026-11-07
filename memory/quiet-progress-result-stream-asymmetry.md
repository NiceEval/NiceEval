# --quiet 下进度流/结果流不对称:errored 全程无声,极像"还在跑"

## 现象

`--quiet` 运行时,attempt 进度行(`starting sandbox...` 等)照常出现在 stderr,但某个
attempt errored(实测:e2b 起沙箱 3.9s 后 control-plane fetch 失败)时控制台**零输出**——
没有 error 行、没有 errored 标记,只有跑完读 `summary.json` 才能发现。对着 stdout/stderr
做实时监控的工作流(下游 agent 盯日志)完全失效:静默与"还在跑"不可区分。下游反馈时
的第一假设是"起沙箱抛错绕过了 reporter 的 error hook",还把串行交接误读成了并发失控
(前一个 attempt 静默 errored 释放 permit,后一个立刻起沙箱,看起来像同时在跑)。

## 根因

不是 error hook 被绕过——起沙箱失败会被 `src/runner/attempt.ts` 的 `catchAllCause`
兜成 errored `EvalResult`,照常流到 `onEvalComplete`。真正的机制是设计不对称:

- 进度流:attempt 的 `log()` 在没有 onProgress(即没挂 Live)时**直写 stderr**,不受
  `--quiet` 控制;
- 结果流:只走 reporter 管线,而 `src/cli.ts` 的 quiet 分支把 Console/Live 全摘掉了。

于是 `--quiet` 下流看起来活着,结果流却是死的——半静默比全静默更误导。

## 修法

新增 `src/runner/reporters/quiet.ts`:极简 Quiet reporter,只实现 `onEvalComplete`,
verdict 为 errored / failed 的结果各写一行 stderr(eval id、`[who]`(runWho 同源)、
verdict、截断 200 字符的 error 或首个失败断言),passed / skipped 静默;`src/cli.ts`
quiet 分支 push 它,结果流仍走统一 reporter 管线。契约同步:FLAG_OPTIONS JSDoc →
`pnpm docs:reference` 再生成、`docs/cli.md`、docs-site 中英 reference。

适用判断:凡"某类事件只走 reporter 管线、而某模式会摘 reporter"的组合,都要检查
剩下的直写通道会不会制造"流活着但关键事件缺席"的假象。
