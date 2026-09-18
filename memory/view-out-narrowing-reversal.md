---
format: concord.document/v1
id: view-out-narrowing-reversal
title: 设计裁决:view --out 从「与收窄互斥」翻案为「收窄决定出站内容(有效根)」
createdAt: 2026-07-17T16:17:11+08:00
createdAtSource:
  kind: first-recorded
  path: memory/view-out-narrowing-reversal.md
  commit: dcb561b13954f052ca99ee4704a6f347bc9f06db
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---
# 设计裁决:view --out 从「与收窄互斥」翻案为「收窄决定出站内容(有效根)」

- **裁决**(2026-07-17):`view` 的位置参数 / `--exp` 是站点管线输入,把结果根滤成**有效根**;页面 Scope、烘进 HTML 的 viewData、`artifact/` 证据树一致地只含有效根,本地与导出零分叉。`view <收窄> --out` ≡ 对收窄后的根导出。同日 `--experiment` flag 更名 `--exp`(与 `niceeval exp` 同词)。
- **曾选方案 A**(旧契约,view.md 原「按实验收窄发布 = 换一个根」节):`--out` 与收窄互斥,按用法错误退出,发布收窄只能走 `copySnapshots + filter` 构发布根。否决理由:最常见的发布任务(只发布一个实验组)要写一个 TS 脚本加两步命令,DX 伤口就落在 copySnapshots 动机来源的那个消费仓库(coding-agent-memory-evals 的 Vercel 构建)上。
- **曾选方案 B**(讨论中被否):收窄语义与本地 view 完全一致——只过滤页面 Scope,证据树全量出站。否决理由:页面显示只有 compare、`artifact/` 里 dev-e2b 的 prompt/输出/源码全部出站,发布者被误导,这正是旧互斥要防的事故。
- **曾选方案 C′**(实现中途被收紧):收窄只滤证据文件清单,viewData 保持全量、本地宿主「越过收窄」解析 attempt 深链。否决理由:viewData(判定、摘要、annotated 数据)烘进 index.html,被滤实验的数据仍随 HTML 出站,承诺没兑现;且本地宿主要长出「清单外回根查找」的特例,破坏两宿主对称。
- **代价**:本地 `view --exp compare` 下,被滤掉实验的 attempt 深链不再可达(旧行为可达)。逃生门:不带收窄重新打开完整 Scope。
- **落点**:契约 `docs/feature/reports/view.md`(开篇 + 静态导出)、`docs/feature/reports/architecture.md`(attempt 详情路由);实现 `src/view/data.ts`(loadViewScan 的 scopedExperiments / matchEval)、`src/view/index.ts`(删互斥校验);用例 `docs/engineering/testing/unit/reports.md`、`src/view/view-report.test.ts`。
