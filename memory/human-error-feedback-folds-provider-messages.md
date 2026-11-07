# Human error feedback folds provider messages

## 现象

同一次 `niceeval exp` 中，E2B 与 Vercel 都在 `sandbox.create` 失败且具有相同 phase/code 时，Human 结束面只显示
`×2 errored · sandbox.create · unexpected-error` 和一个代表 locator，两条 Provider message 都消失。Attempt 创建前
的 Docker 构建失败同时暴露内部 `shared failure: n1`；长单行错误依赖 panel 的防御性截断，关键信息可能不可见。

## 根因

`buildFailuresPanelRows()` 对 execution error 的分组键只有 phase 与 code；`buildPreAttemptErrorRows()` 把 timing
node ID 当成 Human 信息，并把未折行的逻辑行直接交给只负责截断的 panel renderer。receipt 的 Run ID 列表也没有
和用户可识别的 Experiment 配对。

## 红灯收据

- candidate sha256：`e220d46c04ab071f0de96c13319ec00355618d4935e96c979653ad500bcae46a`
- 公开入口：安装 candidate 后运行 `niceeval exp provider-error --rerun all`
- E2E summary：`/tmp/niceeval-provider-error-tdd.ISsMdE/red-2-artifacts/summary.json`
- 旧输出证据：两条不同 Provider error 合并为 `×2`，共享构建显示 `shared failure: n1`。

## 修法

- execution error 不再按 phase/code 聚合；每个 Attempt 展示其安全封口后的 typed error `message`，紧跟
  `details: niceeval show @<locator>`。
- 单条 error 剥除控制字符、限定 240 字符并保留尾部，再按 panel 显示宽度折行；`cause` 不回退进 Human。
- pre-Attempt Human 隐藏 timing node、BuildKey、failureId、phase/code 包装和枚举式 fix。
- plan 内保存 Experiment → draft Run 映射，但仅在 receipt 确认 Run 已发布后用于 `NEXT`，按 Experiment 输出
  `details: niceeval show --run <runId>`。
- owner：`e2e/cli/test/provider-error-feedback.test.ts`；可靠性接管六种观察全部通过，收据在
  `/tmp/niceeval-provider-error-tdd.ISsMdE/final-takeover-artifacts/takeover-summary.json`。
- 最终 candidate sha256：`462fa9beacd029db3bc0bee4e3812188798aa340634994f934eb779dbf54a8d3`；完整 CLI
  suite 收据在 `/tmp/niceeval-provider-error-tdd.ISsMdE/final-full-cli-artifacts/summary.json`。
