---
format: niceeval.memory/v1
id: judge-config-and-check-sugar
title: Judge 模型配置与 Match 断言分工，官方方法复用 check
createdAt: 2026-09-13
kind:
  type: decision
  state: adopted
promotions:
  - kind: feature
    current:
      - docs/feature/judge/library.md
    history: []
---
用户明确要求 `defineEval.judge` 为每道题配置 Judge 模型，官方 `t.factuality()`、`t.closeQA()` 等则是断言方法。把该字段解释成精确 Match 实例允许列表，会迫使作者重复声明，并混淆执行配置与评价标准。

裁决：保留现有 `defineScoreMatch`、`defineJudge` 和统一 `t.check`。官方方法只构造对应 Match 后转交接收者的 check，共用材料快照、预算、求值、handle 与审计。模型配置按 Experiment、Eval、项目默认逐字段取值。

移除允许列表后，派发前不能可靠判断任意 test 回调是否使用 LLM。取消独立网络预检，由真实原语请求及严格响应校验确认能力，避免纯断言受 Judge 端点影响，也避免额外未记账请求。

自动复用仅保证已捕获源码、已登记数据与有效配置的身份。运行期 Match 摘要用于解释审计，不能证明尚未执行的定义相同。未捕获的环境或动态依赖变化必须在选中范围使用 `--rerun all` 重验。内置算法变化维护独立 Judge authoring protocol 版本，不迁移历史结果 schema。

本次独立只读设计挑战经问题、父 agent 回答与再审后给出 PASS；实现和测试证据另由当前契约与 E2E owner 拥有。
