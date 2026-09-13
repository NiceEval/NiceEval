---
format: niceeval.memory/v1
id: llm-x-judge-turn-material-gap
title: LLM X 接入声明式 Judge 缺少应用材料入口
createdAt: 2026-09-13
kind:
  type: problem
  state: open
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
