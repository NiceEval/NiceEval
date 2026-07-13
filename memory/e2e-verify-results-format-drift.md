---
name: e2e-verify-results-format-drift
description: e2e.yml 每次 push 必红——verify.mjs 还按落盘改快照(schemaVersion 4)之前的 summary.json 布局校验；e2e 重构期间已暂停 push/PR/nightly 自动触发
metadata:
  type: project
---

**现象**：`.github/workflows/e2e.yml` 的 `e2e-matrix` 与 `e2e-sandbox` 两个 job 每次 push 到 main 必红。`Verify (exit codes + summary.json 对账)` 步骤对全部 10 个 project/exp 组合报 `找不到 summary.json`，即使 CLI 自己的收尾输出明确打印 `Structured results: .niceeval/ci/<snapshot>/ (snapshot.json + per-attempt result.json / events.json / trace.json / diff.json)`——文件其实都在，只是不叫这个名字。

**根因**：`[[results-per-snapshot]]` 那次改动（`d0b6718`，2026-07-11）把落盘单位从 run 级 `summary.json` 换成了快照级 `snapshot.json` + 每条 attempt 一份 `<evalId>/a<n>/result.json`，`docs/feature/results/` 与 `docs/engineering/e2e-ci/README.md` §5 都同步改成了新契约，但 `e2e/scripts/verify.mjs` 的实现从未跟上——它靠自己手写 `readdir` 递归扫描 + 硬编文件名 `summary.json` + 猜 `summary.results[]` 字段，而不是调用 `src/results` 已经导出的公开读取面 `openResults()`。这是重复造轮子：`format.ts` 头部注释明确说"布局知识只住在这个库"，`verify.mjs` 违反了这条边界，长出一份平行、没有任何机制强制同步的格式知识，所以格式一改这里就静默错位，直到手动跑一次 CI 才暴露。

对照 `docs/engineering/e2e-ci/README.md` §5，verify.mjs 本该做三件事：①退出码+落盘对账、②缓存行为专项（--force vs 不带时 `artifactBase` 的断言）、③artifact 形状专项（抽查 `snapshot.json`/`result.json`/`events.json` 字段）。实际代码只实现了①，且用错文件名，等于 0/3 生效；②③从未写过。`e2e/README.md` 和 `verify.mjs` 自己的头部注释也还停在旧措辞。

**修法**：e2e 正在重构，不值得现在修 verify.mjs 再被推翻一次。临时止血 = 暂停 `e2e.yml` 的自动触发（`push`/`pull_request`/`schedule` 三个触发器全部注释掉，只留 `workflow_dispatch`），不拿一个已知会红的检查挡日常 push（`.github/workflows/e2e.yml`,2026-07-13）。真正修复要等 e2e 重构落地时一并做：把 `latestSummary()` 一类的手工扫描换成 `openResults()`（或至少复用 `format.ts` 导出的 `RESULT_FILE`/`SNAPSHOT_FILE` 常量），并补上文档承诺但代码缺失的缓存行为、artifact 形状两项专项校验，重构完成后把三个触发器加回来。

另有一个独立的、无关的红：`ci.yml` 的 `Package and site` job 里 `INIT.md` 与 `site/public/INIT.md` 内容不同步（纯文案漂移，diff 就能看出来），未处理，不在本条目范围内。
