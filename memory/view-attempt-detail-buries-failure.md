---
format: concord.document/v1
id: view-attempt-detail-buries-failure
title: view Attempt 详情把失败原因埋没:断言区缺失 + timing 树全展开压顶
createdAt: 2026-07-16T10:15:06+08:00
createdAtSource:
  kind: first-recorded
  path: memory/view-attempt-detail-buries-failure.md
  commit: 1cc22c6b637b1838e9a134a6ed06788b36fa3800
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
    statement: "## 已修(2026-07-24 复核):整棵旧弹窗被换成 attempt-detail 组件族"
    proof: []
    source:
      path: memory/view-attempt-detail-buries-failure.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:c213db20810cedef11c05f35dbbf4752b6f32acd826cb1dedacbb2e7a7ae14ef
---
# view Attempt 详情把失败原因埋没:断言区缺失 + timing 树全展开压顶

## 现象

`niceeval view` 打开一个失败 attempt 的详情弹窗,首屏从上到下全是全展开的 timing 时间树(sandbox.queue / agent.setup / eval.run 及其全部 shell/turn 子行)加 usage 行;没有任何断言区块。要知道「为什么失败」,必须滚过时间树和整份 Eval 源码,找到代码视图里的红色行,再点击该行才展开 expected / received。契约(`docs/feature/reports/view.md`「Attempt 详情」)要求的断言区——failed / unavailable 先展开、每条失败直接显示 matcher、expected / received 或 reason、passed 按 group 折叠计数——在 view 里不存在。

## 根因

三次变更叠加,且没有任何测试拦截:

1. `26e967e` 把断言改成只在代码视图行内锚定(gutter 勾叉 + 点行展开),删掉了旧的分组断言视图——从此失败明细必须交互挖掘。
2. `792aae0` 在弹窗顶部插入统一时间树面板(`PhaseTimingBlock`),children 无折叠交互、无条件全展开,把代码视图(唯一的失败线索)压到首屏之外。
3. `74affaf` 定稿断言区契约(docs-first),但 view 侧实现从未跟上;`show` 有对应实现,view 没有。

脱节能存活的结构原因:view 证据室 App(`src/view/app/components/AttemptModal.tsx` / `CodeView.tsx`)没有 DOM 契约测试,`docs/engineering/testing/unit/reports.md` 也没有 Attempt 详情的登记行——契约写了,没有场景行,实现 Agent 就不会为它写测试。

## 修法

- 测试方案(已落):`docs/engineering/testing/unit/reports.md`「Attempt 详情(view 证据室)」分区四行 + `docs/engineering/testing/unit/reports.md`「view 证据室的观察面」——证据室按确定性渲染语义在单元层测 DOM 结构事实,折叠态用原生 `<details>` 表达使静态 render 可断言;不进 E2E 层。
- 实现修复(已做,但走的是另一条路):没有按 `plan/view-attempt-detail-evidence-first.md`「给旧弹窗补断言区」修,而是把整个旧弹窗**替换掉**了——那份 plan 与 `src/view/app/components/AttemptModal.tsx` / `CodeView.tsx` 现均已不存在。

## 已修(2026-07-24 复核):整棵旧弹窗被换成 attempt-detail 组件族

判据(三条各自可查):

1. **根因里点名的两个文件都没了**:`src/view/` 下 `AttemptModal*` / `CodeView*` 零命中,整棵客户端手渲染树随 [view-client-fetch-machinery-fully-removed](view-client-fetch-machinery-fully-removed.md) 删除,attempt 详情改为 fetch 一份独立文档塞进 dialog。
2. **断言区作为一等组件存在**:`src/report/components/attempt-detail/AttemptAssertions.tsx` 头注即「全量 assertion,非 passed 默认展开、passed 按 group 折叠计数」——正是契约要求、当时 view 里不存在的那个行为;它与另外十个叶子一起装进 `standardAttemptPage`(`src/report/built-in/standard.tsx`),show 与 view 共用同一份。
3. **测试脱节的结构原因已消除**:`docs/engineering/testing/unit/reports.md` 有 Attempt 详情的登记行,组件族的渲染矩阵覆盖见 [render-matrix-not-just-data-matrix](render-matrix-not-just-data-matrix.md)。

复盘价值:这条与 [attempt-detail-component-level-green-composite-broken](attempt-detail-component-level-green-composite-broken.md) 同属「组件对、组合层缺」——当时选了「重建组合层」而不是「给旧组合层打补丁」,事后看是对的,因为原根因的三次变更叠加(`26e967e`/`792aae0`/`74affaf`)本身就说明旧组合层没有可维护的契约。
