---
format: niceeval.memory/v1
id: llm-x-judge-turn-material-gap
title: LLM X 接入声明式 Judge 缺少应用材料入口
createdAt: 2026-09-13
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_5EMQGNQKCNPKT4TT
      - netake_71D61PSEAXKBZS3S
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/eval/test/assertion-judge-unavailable.test.ts#necase_Z1PAQPEQGDRFSCQ0"]}
promotions: []
---
# LLM X 接入声明式 Judge 缺少应用材料入口

## 场景与证据

将 PR #217 的 `e90f8288a97a569c85305fe104669d394366560f` 合入 `llm-as-j`，本地原 HEAD 为 `e1c66d311`。合并保留自定义 Adapter 的共享 Assertion runtime，将新的 Judge declaration 校验接入同一入口。

`examples/zh/llm-x/evals/content-quality.eval.ts` 使用 `closedQA`、`judge: true` 和字符串 input/output；`experiments/live.ts` 使用旧的 `judge` 配置字段。#217 移除了旧 factory，要求 `defineJudge` 与 `judgeRuntime`。安装后候选通过公开 `niceeval/expect` 导入 `closedQA` 时返回 SyntaxError，退出码 1。诊断只加载模块，没有调用付费模型。

复现命令为 `pnpm e2e diagnose exec --from /tmp/llm-as-j-merge-e2e/summary.json --repo eval -- node --input-type=module -e 'import { closedQA } from "niceeval/expect";'`。这条命令依赖本次保留的 E2E 场景，重新调查时需要先取得当前候选的 retained summary。

合并候选通过根 `pnpm typecheck`、`pnpm test` 的 78 项 Unit 和 `pnpm lint`。`pnpm e2e test --repo eval --keep-workdir --artifact-root /tmp/llm-as-j-merge-e2e -- --run test/assertion-judge-unavailable.test.ts test/custom-application.test.ts test/application-types.test.ts` 的 3 个文件、4 个用例通过。这证明现有 Judge 和普通应用路径可运行，不证明两者已经可组合，也不证明 llm-x live 可运行。

## 根因与影响

`packages/niceeval/src/assertions/judge.ts` 的运行时 View 只有 turn-input 与 turn-reply，公开材料来自 `Turn.material`；reference-text 属于定义期材料。`judge.check` 验证品牌、声明归属以及运行时材料来自同一个 Turn。

LLM X 自定义 Adapter 返回 Post、World 和延迟产生的回复列表，没有 Turn。动态人物资料、帖子上下文与后续回应无法直接进入新 Judge；把这些数据当作定义期 reference 或伪造 Turn 都会掩盖材料来源。

`packages/niceeval/src/adapter.ts` 的公开 EvalContext.check 也仍只有普通 Match 重载，Agent Context 才拥有 JudgeCheckFunction。因此只把旧 factory 改名或提供一层快捷函数不足以迁移该示例。

## 后续研究边界

需要讨论应用操作结果怎样成为受管材料、多个操作的上下文怎样组合，以及材料与 Attempt 的归属。应保留 `t.post()` 等领域方法的返回类型，保留 Assertion 的 score、label 和 gate。具体 API、信任边界与材料生命周期尚未定案。

示例的评分标准也需要拆清：发现页相关性、多样性、自然度不是同一个判分命题；人物一致性需要针对对应人物与回应给出理由。现有四项各 25 分是任务权重，不是已经校准的模型质量量尺。

前次真实运行的结果见 [LLM X live Match 使用记录](llm-x-live-match-dogfood.md)。那份记录基于旧 Judge API，不是此次合并候选的验收。

## 采用的修法与验收

2026-09-13 采用 [Judge Library 契约](../docs/feature/judge/library.md)：`defineJudge({ name, rubric, anchors })` 返回可复用的 Match，应用与 Agent 统一用 `t.check(material, definition)`。定义表达评分标准；作者显式选择领域材料，库只证明登记快照与发送内容一致，不宣称材料自动来自某次生产动作。独立 Astra 设计挑战在明确预算、发送状态与历史版本边界后通过。

完整请求以受管 Assertion material 保存，v2 读回严格验证协议、顺序、字节与摘要。`attempted` 在实际 HTTP 边界登记，取消终止请求并保留发送事实。安装后公开类型检查发现并修复了自定义 Adapter 缺 Judge 重载、阈值结果缺 gate 的遗漏。

正式旧候选红灯 `nered_P5QMBZMZST3PGHKC`，同一公开 case 的完整接管凭据 `netake_9S5RJVT56F0301V3`。候选 SHA-256 为 `d1515ff5455bcfb2eada4225159919c3015f55e4a13cf3b3c9d38ba4ccbcc6bb`。7 项针对性公开检查、78 项 Unit、根 typecheck 与 lint 通过；LLM X 安装同一候选后 typecheck、build、smoke、fixture 通过，Query 读到 completed Attempt 与 18 条 Assertion。

LLM X 示例将发现页相关性和多样性分开，五项评分带 0 / 0.5 / 1 描述，总分 100。此次没有付费 live 调用，也没有校准任务权重或证明 Judge 与人工评分一致。

## Resolution history

<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `6ff241edc8098804d9d33eba720c33b4c52f488e`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_P5QMBZMZST3PGHKC",
    "netake_9S5RJVT56F0301V3",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/eval/test/assertion-judge-unavailable.test.ts#necase_Z1PAQPEQGDRFSCQ0\"]}"
  ]
}
```
