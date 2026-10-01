---
format: concord.document/v1
id: scope-warnings-group-by-action
title: 裁决：ScopeWarnings 按动作聚合 + 明细折叠（2026-07-17）
createdAt: 2026-07-17T14:12:36+08:00
createdAtSource:
  kind: first-recorded
  path: memory/scope-warnings-group-by-action.md
  commit: 177a151c4b41ba97515f17af597b1f91c23a9cac
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
# 裁决：ScopeWarnings 按动作聚合 + 明细折叠（2026-07-17）

`ScopeWarnings` 的呈现契约从「逐条平铺 message、明确无折叠」翻案为「按下一步动作聚合成组，组头（存在 / 分类 / 命令）恒可见、逐条 message 收进 `<details>` 明细」。

## 被推翻的表现

原契约把每条警告的 message 平铺成一个 `<ul>`，一条一行；折叠被明确视为对信任模型（「警告可见性是作者义务」）的削弱而不做。用户在 view 页面（`.report-slot > .nre > .nre-warnings`）反馈条数一多可读性差，触发重设计。

平铺的真正问题不是长，而是组织轴错了：`partial-coverage` / `stale-snapshot` / `unfinished-snapshot` 三种 kind 都带 `experimentId`，`command` 完全相同（`niceeval exp <id>`）——同一个实验触发三条警告时，用户要做的事只有一件，平铺却渲染三条长句加三个重复命令。分类（kind）和行动（命令）两层信息都压在 message 文本里，是可读性差的根因。

## 定稿

- 聚合轴选「动作」（experimentId）而非「类型」（kind）：kind 降级为组头徽标，组边界跟着「用户要做什么」走，顺带天然去重命令。非实验作用域的 kind（`unreadable-snapshot`）按 kind 聚合。
- 折叠折的是**明细**（原始 message），永不折叠的是存在、分类计数与下一步命令——信任模型要求「警告可见」，不要求「警告全文可见」。web 面用原生 `<details>`（无 JS 可展开，不破增强层不变量），总条数 ≤ 3 默认展开；text 面同构但不折叠。
- kind 表新增两列契约：类别（`integrity` / `freshness`，组件排序依据；避用「严重度」——那是断言 gate/soft 的专名）与徽标 / 组头模板（en 文案，zh 走组件 chrome 词典；message 不经模板，仍是叙述单源）。
- 折叠阈值是行为契约，不设 props 开关（同 `PoweredBy`「提供组件、不给开关」）。

## 否决的方案

- 按 kind 分组（分类优先）：保留了「什么类型的问题」但丢掉命令去重，同一实验的三条警告仍散在三组。
- 整块折叠成角标 / 计数：违反「警告与数字同框」的信任模型。
- 给组件加 `collapsed` / 阈值 props：折叠规则属于行为契约，开关会把作者义务变成配置纠纷。

## 落点

契约：`docs/feature/reports/library/site-components.md#scopewarnings`、`docs/feature/results/library.md` kind 表两列；实现：`src/report/scope-warnings.ts`（聚合层，web/text 共用）、`src/report/web.ts` / `src/report/report.ts`（两面渲染）、`src/report/locale.ts`（chrome 词典）、`src/results/select.ts`（`gapParts` 时距单源）；测试登记：`docs/engineering/testing/unit/reports.md`，测试在 `src/report/dual-render.test.tsx`。当时 `ScopeWarnings` 组件本体尚未从宿主级警告块迁出，聚合层落在宿主渲染函数上，组件化（见 [`reports-no-privilege-chrome-rulings`](reports-no-privilege-chrome-rulings.md)）时整体搬移。
