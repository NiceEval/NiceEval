---
format: concord.document/v1
id: record-only-assertions-labeled-soft
title: Record-only Assertion 被标成 soft
createdAt: 2026-08-20T20:32:17+08:00
createdAtSource:
  kind: first-recorded
  path: memory/record-only-assertions-labeled-soft.md
  commit: c2fee91465b304e9b02c5145b2143f4791e14a38
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [record-only-assertions-labeled-soft](record-only-assertions-labeled-soft\
      .md) — Attempt 展开把未计分 Assertion 标成 `soft`，正常 `notCalledTool`
      看不出这是已记录的零命中结果；改为 `recorded passed/failed/unavailable`，并由浏览器 E2E
      守住零命中与决定性见证"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# Record-only Assertion 被标成 soft

## 现象

Attempt 详情把没有 points、也没有失败 gate 的 Assertion 显示成 `soft passed` 或 `soft failed`。用户展开正常的 `notCalledTool` 时，虽然诊断已经保存 `0 definite matches`，标题仍无法说明这是一条只记录结果、不贡献分数的检查。

## 根因

Report 展示投影只从 gate 是否失败派生 `gate | soft`。它没有读取 sealed score contribution 的 `not-scored` 状态，因此把 record-only 与带 points 的非 gate Assertion 合并成同一个 `soft` 类别。

## 修法

Attempt 展示投影先保留失败 gate，再把 `score.state: "not-scored"` 显示成 `recorded`。带 points 的非 gate Assertion 继续使用 `soft`，已有 contribution 与 `+N` 不变。`notCalledTool` 的展开正文继续来自已封口 diagnostic，并显示零命中或决定性命中位置。

## 回归收据

owner 是 `docs/engineering/testing/e2e/report.md#report-browser-journey`。Report 场景用安装后的候选运行确定性 Experiment，再经 `niceeval view` 和真实 Chromium 打开 Attempt 详情。

- 旧行为 candidate SHA-256 `d478928a7a0f062e385c81c0ce71a4207e5b63475dc940c7c78db3ad8fd18c1f`：浏览器找不到 `Turn completed · recorded passed`，最早在 outcome 检查点变红；artifact `/tmp/niceeval-e2e-artifacts-HPdVOY`。
- 修复行为 candidate SHA-256 `069d27b886b69b502ef8dbab44dfade591d4c41ff4d5d622bc6f5f229ac530d7`：同一浏览器 owner 通过，artifact `/tmp/niceeval-e2e-artifacts-pCsS9V`。
- 可靠性接管 candidate SHA-256 `a8407cb45cc00e33f8da05206b08764bfbe2030c296e1ba2ed9c2d71a0e30af5`：三个隔离副本、同一安装副本重复运行、Repo 默认并行入口及目标单测均为 clean pass；矩阵完整，所有运行 `cleanupOk: true`，source snapshot cleanup 成功。summary `/tmp/niceeval-recorded-assertion-takeover.LP2eca/receipts/takeover-summary.json`。

测试不读取 Record 私有文件，也不调用 Report 内部函数；红绿都来自安装后 CLI、HTTP 与浏览器可见结果。
