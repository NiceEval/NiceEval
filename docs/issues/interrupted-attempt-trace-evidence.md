# 补充 #126：中断成员无 trace 入口，超时轮次缺少执行事件与 timing

## 关联与类型
本地补充证据稿，供既有 GitHub Issue #126（https://github.com/NiceEval/NiceEval/issues/126）后续更新；不新建重复远端 Issue。建议 enhancement、area:record、area:runner、area:adapter、needs-triage。与 live-attempt-progress 的运行中阶段提示相关，但本稿聚焦中断后的执行证据。

## 公开入口观察
2026-10-26，NiceEval-Eval 的 OpenSandbox / Codex dogfood，通过安装候选的 niceeval.query/v3 与 show 检查：

1. Run 1bae6021-cbb3-4b9b-a4fb-44fce769bacb 在第二个成员执行时收到 SIGINT。run.get 显示该成员 publication.state=absent、reason=interrupted-before-publication；show --run 显示 interrupted、Attempt not-recorded、member-not-observed。前一个已完成成员 @180R1R435VW9N 仍可读取。当前 discover 只有基于 Attempt locator 的 trace operation，没有以未发布 planned member 为目标的 trace 入口。因此不能审计被中断成员已经发生的执行过程；这不是宣称前一个已完成成员也丢失。
2. 超时 Attempt @15RN8P2GBDACE 已发布，show --execution 和 attempt.trace 可读取第一轮与 timeout diagnostic。第二轮 turn_zx6290q4d15ywmfatk5069q18m 标为 interrupted，但只含一条 user message，未提供其后执行事件。完整 timing 响应 hasMore=false、omittedActivityCount=0，只有第一轮 258490ms 的 agent.send activity；eval.run 为 2905714ms，没有第二轮 activity。无法从公开证据解释后续约 44 分钟在等待什么。

## 复查命令
先 pnpm --silent exec niceeval query discover，再执行固定请求：
```sh
pnpm --silent exec niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"run.get","runId":"1bae6021-cbb3-4b9b-a4fb-44fce769bacb"}}'
pnpm --silent exec niceeval show --run 1bae6021-cbb3-4b9b-a4fb-44fce769bacb
pnpm --silent exec niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"attempt.trace","locator":"@15RN8P2GBDACE"}}'
pnpm --silent exec niceeval query run --request-json '{"protocol":"niceeval.query/v3","operation":{"kind":"attempt.timing","locator":"@15RN8P2GBDACE"}}'
```
这些固定标识需要原项目 Record；可复现场景为多成员 run 在后续成员 Agent 执行中 SIGINT，以及第二轮 Agent 执行中触发 Eval timeout。未声称已用无模型最小 fixture 复现。

## 期望与影响
中断后应有公开 owner 能读取已捕获的部分事件、最后已知阶段和未完成 timing，并明确哪些证据不可用。若不支持未发布成员 trace，CLI 应明确说明限制及可用恢复路径。长时间运行没有可审计事件会阻碍区分模型请求、工具执行、目标服务与 Runner 卡住；不能仅以增大 timeout 代替诊断。

## 来源与环境
Linux x86_64、Node.js 24.19.0、pnpm 11.12.0，OpenSandbox/Kata、内置 Codex；宿主使用 NiceEval 本地 OpenSandbox 候选（当前代码线 6c838c1ae），query 协议 v3；被测文档分别为 0.19.0 与 0.19.1-canary.104，不能将被测版本误当宿主运行时版本。来源为 NiceEval-Eval 真实付费 dogfood；所有证据仅从公开 show/query 取得，未读取私有 Record 文件。
2026-10-26 分页读取全部 open/closed GitHub Issues，排除 PR，共 49 项；#126 是相关 canonical owner。#283 涉及 Docker stdout 累积复制，不能凭标题认定是本次长耗时根因。正文已脱敏，不包含凭据、私有对话或私有 endpoint。
