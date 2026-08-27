---
format: niceeval.memory/v1
id: inspection-query-missing-overview-and-trace-detail
title: Inspection Query 缺少 Overview 与稳定 trace detail
createdAt: 2026-08-26T21:21:31+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Inspection Query 缺少 Overview 与稳定 trace detail

## 问题

0.12 `show` 曾交付 Overview 与折叠后的 execution 下钻；迁移到 0.13 固定 Query 后，machine consumer 只取得 operation 名称与有界 preview，无法从公开 Inspection CLI 完成原有的默认概览与精确详情读取。

当前 `run.summary` 一次只关闭单个 Run，`runs.compare` 也没有关闭 Experiment × Eval cell 的 pass rate 与 score。因而自动化无法直接取得同时覆盖多个 Experiment 与 Eval 的 expected／observed denominator、Verdict tally、pass rate、score 状态与 earned／possible，以及 Run／Attempt 下钻身份。第一方 View 仍自行计算 Overview，使 machine Query 与人读 Insight 没有共享一个已关闭的业务聚合结果。

当前 `attempt.trace` 只交付 preview。即使 outline 暴露 exact `toolOccurrenceId`，公开 catalog 也没有按稳定 `itemId`、`toolOccurrenceId` 或 `commandId` 取得同一项已封存详情的 operation；调用方无法从同一 occurrence 读取完整 call/result，同时保留 producer 已封存的限制与稳定 item identity。

## 影响

AI 与 automation 若要回答默认 Overview，只能枚举 Run 后自行重算成员、分母、Verdict 与 score；若要取得 trace 详情，只能依赖 preview、私有 Record 或显示位置。这会产生与 View 不同的第二套聚合，并诱使调用方恢复 `t<N>.c<M>`、`cmd<N>`、数组 index、Turn 或卡片序号等不稳定位置 handle。

## 当前边界

本 Problem 保持 open。它只记录公开入口缺失及其可观察后果；最终修法、result schema、共享 Node／Browser 执行方式与封存限制如何表达，仍须由产品实现、同一安装后 E2E owner 的红绿收据及可靠性接管共同验收。
