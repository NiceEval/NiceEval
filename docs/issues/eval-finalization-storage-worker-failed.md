# 全部 Attempt 发布后 storage worker 失败且缺少 receipt

## 观察

2026-11-11 在 NiceEval-Eval 执行 0.20.0 候选的 7 格真实评测，全部 Attempt 发布后，外层 CLI 以 exit 1 结束，stderr 为 `experiments run invocation failed: record-sqlite-error: storage worker failed`，NDJSON 没有最终 receipt。安装 Run 留在 active 但 coverage 为 2/2；Harness Run 为 completed、5/5。

## 公开入口与证据

命令：`pnpm --silent exec niceeval exp --experiment install/v0.20.0 --experiment harness/v0.20.0 --rerun all --no-pause --json`。

Invocation：`s_c42c070b-b816-44c1-8d82-0e4cf8235f4b`。安装 Run：`7c0bcfef-c578-4ca1-bd68-a8da64846616`；Harness Run：`f4b1f8ce-74b1-4d93-a9e9-5de28e83dfd4`。公开 `query run` 的 `run.get` 确认 7 项均 published。原进程退出后，`niceeval run recover 7c0bcfef-c578-4ca1-bd68-a8da64846616 --yes` 成功将安装 Run 标为 interrupted。Instabox 原生 list 确认无本次残留实例。

运行约 42 分钟，最后进度为 DB-GPT assertions.evaluate。诊断没有给出 storage worker 的底层错误；根因未调查，不推断数据库损坏或结果丢失。

## 期望与影响

全部结果发布后应可靠结算 Run 并交付 receipt；失败也应提供可操作的底层原因与恢复信息。当前用户无法从退出码和 receipt 得知七项结果已保存，需额外查询及恢复。没有重复付费运行。

## 环境与来源

外层为本地 linked NiceEval，CLI version 为 0.0.0-development，调查时核心 HEAD `79781936b43e68f5623ce3636733d1ebc8392043`；该 HEAD 不代表已核验 dist 构建身份。内层被测 npm 包为 niceeval@0.20.0。Linux、Node v24.21.0、pnpm 11.18.0、Instabox、Codex gpt-6.1-sol。来源：NiceEval-Eval main 39b7e10 的 agent-assisted dogfood。

已检查本地条目及 GitHub open/closed 的 storage worker 搜索，未找到相同观察。仅本地草稿，未执行远端 mutation；建议标签 bug、area:record、area:runner、needs-triage。正文不含凭证或私有对话。
