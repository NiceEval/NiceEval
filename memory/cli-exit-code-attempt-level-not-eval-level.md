# CLI 退出码曾按 attempt 计红,重试吸收的抖动照样 exit 1(已修)

## 现象

e2e 沙箱矩阵 claude-code 的 features 实验:`feature-skill-used` 第一次尝试失败、
第二次通过(`runs: 2, earlyExit: true`),两条 eval 最终全部 passed,但 CLI 进程
退出码是 1,verify.mjs 按「期望 exit 0」判红。

## 根因

`summarize()`(src/runner/report.ts)对 `summary.passed/failed/errored` 按**每次
attempt** 计数;`src/cli.ts` 退出码直接用 `summary.failed > 0 || summary.errored > 0`。
于是「先挂一次、重试后通过」的 eval 也会把进程判红——与 docs/e2e-ci.md §4.1
「runs + earlyExit 吸收单次抖动」的设计意图直接矛盾。报表和 view 早就用
`src/shared/outcome.ts` 的 `foldEvalOutcome`(任一轮通过 → 该 eval 通过)按 eval 计票,
只有退出码这层漏了,属于内部口径不一致。

## 修法

`src/cli.ts` 退出码改用 `evalLevelStats(summary.results, r => \`${r.experimentId ?? ""}|${r.id}\`)`
折叠后再判 `failed/errored > 0`;`e2e/scripts/verify.mjs` 的 allPass / failedAtLeast /
erroredAtLeast 同步改为同一折叠口径。`summary.json` 顶层 passed/failed **保持 attempt 级
原始计数不动**(工件格式不变,view/表格本来就自行折叠)——消费方要判"全绿"应自行按
eval 折叠,别直接拿顶层计数。

适用场景:一切"看退出码/summary 判成败"的消费方(CI 脚本、外部工具);以及未来
earlyExit: false 大样本 nightly 要引入通过率阈值时,记得阈值判定也建立在 eval 级折叠上。
