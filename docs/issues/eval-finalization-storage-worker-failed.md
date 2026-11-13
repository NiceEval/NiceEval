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

## 第二次观察与诊断缺口

2026-11-12，NiceEval-Eval 在 `CI=true niceeval exp --rerun all` 下运行 6 个 Experiment、24 个 Attempt，并发 10。Invocation 为 `s_95f342bd-892c-4869-8dfb-d472d94e32c2`。父 agent 通过公开入口确认全部 Attempt 已发布；CLI 再次 exit 1、无 receipt，stderr 仍只有 `experiments run invocation failed: record-sqlite-error: storage worker failed`。5 个 Run 留在 active，coverage 完整；父 agent 已用公开 `run recover` 收口。两次失败都出现在 install/db-gpt 的收尾，最后可见 collecting trace 约 1.9–2 万 span、保留 1000。

本轮未重跑下游付费实验，未读取或修改下游私有 Record 文件。已定位诊断丢失点：Record Host 对非 SqliteRecordError 的 worker Promise rejection 使用固定文案包装，上层只展示该 message。通过安装后 CLI 与真实 SQLite worker，向外部 worker 传输边界注入 EIO，确认该底层原因在 stderr 丢失。此确定性回归仅证明诊断缺陷，不证明真实两次失败是 EIO、OOM、锁竞争或数据库损坏。

原运行未记录 worker 原始 error/exit，现有证据不足以裁定其根因。下一次若仍发生，需要保留改进后的底层 error code/message、worker 操作、Invocation Run ID 与收尾日志；在此之前不改变发布、事务或资源时限语义。本 Issue 保持本地 draft，真实大运行的根因仍待调查。

## 确定性的公开复现

补充大型矩阵验收时发现：在同一 Invocation 中，两个 Experiment 分别写入 550 条有 key 的确定性 Assertion（每份附件均低于 4 MiB，合并矩阵超过 1000 行），通过安装后 CLI 连续运行 3 个 Attempt，稳定在 `stage-final-metadata` 报 `DataCloneError: Cannot transfer object of unsupported type`。命令为 `niceeval exp assertion-matrix --rerun all --json`，不调用任何模型。两个隔离重复都命中同一底层错误；初始候选的回归日志为 `/tmp/ne-dx4-bounds2.log`。这证明存在可独立修复的 worker 传输缺陷；历史两次真实失败没有原始 cause，仍不能直接将其追溯认定为同一个错误。
