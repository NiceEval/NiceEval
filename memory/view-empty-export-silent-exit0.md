---
format: concord.document/v1
id: view-empty-export-silent-exit0
title: view 对零可读结果曾静默导出空报告(exit 0)
createdAt: 2026-07-10T17:59:30+08:00
createdAtSource:
  kind: first-recorded
  path: memory/view-empty-export-silent-exit0.md
  commit: 7c28254f679a2a2678254ce2f2ecbfe86ed2fa40
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [view-empty-export-silent-exit0](view-empty-export-silent-exit0.md) — view 对零选中结果曾静默导出空报告 exit 0，CI 发布会把空站顶上线；全站关闭按 `coverage.selected` 类型化失败为 `report-sample-empty`，已选中结果中的 empty MetricValue 仍可发布"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# view 对零可读结果曾静默导出空报告(exit 0)

**现象**:`.niceeval/` 目录存在但零可读结果(真空,或全部落盘 schemaVersion 不兼容被整批跳过)时,`niceeval view --out site` 照常导出一张空报告并以 0 退出;本地 `niceeval view` 也能对空库起 server 渲染空仪表盘。CI 静态发布场景(Vercel/GitHub Pages 的 buildCommand)里,空报告会静默顶掉线上的上一次部署——消费仓 coding-agent-memory-evals 曾因 25 份 v1 落盘全被 0.5 跳过而只差一个守卫脚本兜住。

**根因**:旧 view 管线曾只在 `--report` 在场时做零结果校验。ReportExecution 统一读取路径接管后，project-current 会正确形成一个零选中结果的 Sample，但全站关闭路径仍把它当成可发布输入，因而重新暴露了同一用户后果。

**修法**(2026-08-21,`src/report/host/from-record.ts`):全站关闭在打开固定 Sample 后检查 `coverage.selected`；零选中结果类型化失败为 `report-sample-empty`，server 不启动，`--out` 非零退出且不创建目录。已选中结果中的 empty / partial / unsupported / failed MetricValue 仍可发布。公开回归由 `e2e/report/test/report-export.test.ts` 从安装后 CLI 制造身份失配并验证错误与无目录。
