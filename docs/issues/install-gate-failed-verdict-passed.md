# 安装 Attempt 的 gate 标注失败但总判定仍为 passed

## 观察

2026-11-11 NiceEval-Eval 的 GPT Researcher 安装 Attempt `@1TE2JP6T4SHNX`，`niceeval show` 与 query run.get 均报告 verdict passed、34/72；但 `niceeval show @1TE2JP6T4SHNX --assertions` 报告 35 passed / 2 failed，其中 `install.gate.current-attempts` 显示「gate · 当前格包含 Attempt」、FAIL、not-scored、condition-not-met。

## 公开入口

`pnpm --silent exec niceeval show @1TE2JP6T4SHNX`

`pnpm --silent exec niceeval show @1TE2JP6T4SHNX --assertions --entry ae_2a5d302456bf84586dad --full`

固定 Run `7c0bcfef-c578-4ca1-bd68-a8da64846616`；用 niceeval.query/v3 的 run.get 可复核 passed。本次 full assertion 输出没有公开影响 verdict 的结构化策略，故这里只记录「gate 标注与总判定不一致」，尚未判定是题库 gate 声明、运行器判定还是呈现缺口。

## 期望与影响

用户应能从公开入口确认该失败 Assertion 是否实际影响 verdict；真正 gate 失败应使 Attempt 失败。不能只凭 passed 宣称真实业务接入完成。需要明确判定或补充公开证据。

## 环境与来源

外层 local linked NiceEval，CLI 0.0.0-development，调查时核心 HEAD 79781936b43e68f5623ce3636733d1ebc8392043，未核验 dist 构建身份；被测候选 npm niceeval@0.20.0。Linux、Node v24.21.0、pnpm 11.18.0、Instabox、Codex gpt-6.1-sol。来源 NiceEval-Eval main 39b7e10 的 agent-assisted dogfood。

本地与 GitHub open/closed 的 gate/passed 搜重未找到相同观察。仅本地草稿，未执行远端 mutation；建议标签 bug、area:report、area:runner、needs-triage。正文不含凭证或私有对话。
