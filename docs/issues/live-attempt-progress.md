# CLI JSON 进度应标识当前 Eval 与执行阶段

## 类型与期望工作流
Enhancement；建议标签 area:cli、area:runner、needs-triage。
运行耗时较长、串行或有 Sandbox 准备步骤的评估时，脚本和调用它的 coding agent 应能通过公开出口知道当前执行的 Eval/Attempt 及阶段，不必等 Attempt 完成，也不读取私有 Record 或直接进入 provider 排查。

## 实际观察
在 niceeval@0.19.1-canary.104，`niceeval exp local --json` 的 progress 仅报告 total、running、queued、passed 等数量，不包含正在执行的 Eval ID 或阶段。同期 `query run` 的 run.get 已列出计划，但执行中和排队中的两个成员均为 pending、无 Attempt locator，无法据此分辨当前成员。

## 无模型、无沙箱最小复现
安装发布包 niceeval@0.19.1-canary.104，建立 local Experiment，选择 alpha、beta 两条 Eval，maxConcurrency=1。两条 Eval 均执行 `await new Promise(r => setTimeout(r, 45000)); t.check(true, equals(true));`，Adapter 未被调用。
1. `niceeval exp local --json`。
2. 同期运行 `niceeval query discover`，使用其 niceeval.query/v3 协议执行 run.list，取得固定 Run ID。
3. 对此 ID 执行 run.get；计划中的 alpha/beta 都显示 pending。
30 秒时 progress 为 total=2、running=1、queued=1、passed=0，但没有当前成员标识。

## 影响与边界
真实 OpenSandbox 文档评估中，一格可能持续数分钟至几十分钟。公开数据无法分辨正在准备环境、等待 Agent、执行断言或等待 Judge，也无法向用户准确报告当前题目。请求可观察性改进；没有声称等待本身是故障，不要求暴露命令参数、凭据或未封存的完整对话。

## 环境与来源
Linux x86_64、Node.js 24.19.0、pnpm 11.12.0、发布包 niceeval@0.19.1-canary.104。2026-10-26 在 NiceEval-Eval 执行 OpenSandbox 评估时观察，另在独立临时项目通过发布 CLI 复现。复现无付费调用、无外部服务、无 secret。
已搜索 open/closed Issue 的 progress/running 与运行/进度；#118 是 custom-report rebuild 状态，#134 是完成后 unsealed，均不同于本项运行期间的进度可见性。
