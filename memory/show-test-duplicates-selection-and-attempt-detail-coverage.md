---
format: concord.document/v1
id: show-test-duplicates-selection-and-attempt-detail-coverage
title: show.test.ts 曾用整条 CLI 管线复述已有单元覆盖
createdAt: 2026-07-21T21:51:21+08:00
createdAtSource:
  kind: first-recorded
  path: memory/show-test-duplicates-selection-and-attempt-detail-coverage.md
  commit: 1da38e86ca909157adb185c7e781dc1b6d28a8c0
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
      [show-test-duplicates-selection-and-attempt-detail-coverage](show-test-du\
      plicates-selection-and-attempt-detail-coverage.md) — show.test.ts 曾有三条断言经
      `runShow()` 整条 CLI 管线复述 `host-equivalence.test.ts` 已直调
      `selectCurrentResults` 验证过的 Selection 语义,另一条渲染断言自认与 Attempt
      详情组件测试同契约仍留着;测试体系重划 A2 分拣时删除重复覆盖"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# show.test.ts 曾用整条 CLI 管线复述已有单元覆盖

**现象**：迁移前 `src/show/show.test.ts` 里三条断言——「合成 Selection:每 experiment ×
eval 取最新判定」「前缀收窄 Selection 覆盖的 eval」「--exp 让 Selection 只留该实验」——与
`src/results/host-equivalence.test.ts` 的「`selectCurrentResults` · 现刻水位结构化身份」
场景组（跨快照合成、前缀收窄覆盖分母、`--exp` 过滤）逐项重复，但走的是两套不同地基：
show.test.ts 经 `openResults` + `selectCurrentResults` 直调断言 Selection 对象，
host-equivalence.test.ts 同样直调同一个函数、断言同一批字段。另有一条
「解析到对应 attempt,渲染紧凑全景」测试的注释自己写明「与『Attempt 详情组件族:非空/空证据
矩阵』的单元测试同一条契约,这里是集成层确认」——作者已知这是复述别处验证过的组件契约，却仍
留着一份经 `runShow()` 整条 CLI 渲染管线再断言一次的拷贝。

**根因**：数据面与渲染面共存在同一个 CLI 集成测试文件里时，「新场景直接在这个大而全的文件里
加一条 `show()`/`runShow()` 全链路断言」比「回去核对这个语义有没有专门的纯函数测试」更省事；
两处断言的输入构造方式和断言写法完全不同（一处是 fixture 直调函数，一处是起完整 CLI 读渲染
输出的一小段），肉眼审查很难看出是同一个契约的重复覆盖。

**修法**：`plan/testing-layer-realignment.md` A2 分拣时一并核对 `host-equivalence.test.ts`
的既有覆盖，确认三条 Selection 断言重复后直接删除（不再指认新类别）；渲染面复述的「解析到对应
attempt」测试按边界规则整条删除，归 `docs/engineering/testing/e2e/report.md` §4/§5 对真实
产物验收（commit: `test(show): show.test.ts 只留装载/选择纯函数与错误反馈,渲染断言归 e2e`）。
给未来审计的参照：任何「起 `runShow()`/`loadViewScan()` 整条管线再断言其中一小段数据对象」的
测试，先去 `src/results/host-equivalence.test.ts` 和对应组件的 `validate.test.ts`/`*Data`
测试核对是否已经用更直接的方式测过同一件事，不要默认它是新增覆盖。
