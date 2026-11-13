# Agent 安装事实缺少 Attempt 结束后的公开读回

## 观察

NiceEval main `3cdae73da` 的 Agent Ensure 目标契约要求在 live detail 与 `invocation show` 中显示 `hit`、`repaired`、`installed`、探测未命中原因与修复失败原因，但这些事实在 Attempt 结束后没有公开 Record 读回入口。

源码核对：`packages/niceeval/src/runner/source-receipts/model/runner-diagnostics.ts` 的诊断 context 是 entity、limit、provider 三种闭合结构，不能不改变持久格式而加入安装事实。本轮修复遵守父 agent 的裁决，不升级 schemaVersion、不新增 family。

## 期望

为维护者明确设计并审查一种可公开读回安装事实的持久化契约，并给出其固定 Query 入口。该需求独立于本轮就地修复与内存优化，不把 live detail 冒充已落盘证据。

## 影响与来源

Attempt 结束后无法核对安装是否命中、是否修复，以及触发安装回退的具体原因。来自本地源码调查与 NiceEval-Eval dogfood；公开脱敏，不含凭据。仅准备本地 draft，不授权远端 mutation。
