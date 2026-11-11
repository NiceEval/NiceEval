# 批量 show Assertion 详情在 30 秒读取期限后中断

已安装 NiceEval 候选对 131 项 Assertion 的 `niceeval show @<locator> --assertions --full --json` 在约 31 秒后返回 2，stdout 已输出 13 项后追加 `inspection-operation-failed`，stderr 为 `show execute attempt.assertion.detail failed: The Inspection operation could not be completed.`。同一 owner 对每项使用独立的公开 query 可完整读回全部 131 项。

期望批量公开读取能够完成该规模的受支持结果，或输出准确、可行动的资源限制。当前 pinned Record read session 有 30 秒期限；尚未对 bulk 操作的性能与会话边界形成修复方案。

复现数据由 `e2e/eval/test/assertion-values.test.ts` 的 values Experiment 生成；临时采用上述 bulk show 的正式失败收据为 `/tmp/niceeval-ci-final-eval/eval/receipt.json`，完整命令诊断已保存在 `/tmp/niceeval-ci-final-eval/saved-diagnostics/`。候选 SHA-256 `2e22a6ac9420abe500442c6815d6cdb85ae2bcbced1a4f20cb79dbd3bb32e7a8`，源码 HEAD `65bd81a1049d42f86d83124b892804722e743a61`；Linux、Node 24.21、pnpm 11.18。

本轮 CI 修复最终保留 values owner 的串行 query 读取，并按实测调整用例预算，保持全部断言，并未修复 bulk show。并发 query 曾在重复性验收中出现数据库锁竞争，已弃用。已检索 open/closed Issue，未找到相同项。来源为 CI 修复期间的公开 CLI 实验，内容可公开且无 secrets；未发布远端 Issue。
