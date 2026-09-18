---
format: concord.document/v1
id: table-text-face-flat-rows-sibling-key-collision
title: Table text 面拿展平行判同层 key 重复,层级表两父行下同名子行误报
createdAt: 2026-07-29T22:20:07+08:00
createdAtSource:
  kind: first-recorded
  path: memory/table-text-face-flat-rows-sibling-key-collision.md
  commit: 2560d733e14dbbfc77bec57cd7dc5810f0023db2
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
      [table-text-face-flat-rows-sibling-key-collision](table-text-face-flat-ro\
      ws-sibling-key-collision.md) — show 双 Experiment 稳定抛行 key 重复:text 面漏传可选
      hierarchyRows 参数、拿展平行判同层重复;修为 resolver 只产出层级权威形态并单点校验,text
      面渲染期自己展平(primitives.tsx)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# Table text 面拿展平行判同层 key 重复,层级表两父行下同名子行误报

## 现象

`niceeval show` 同时显示两个 Experiment 时稳定抛
`Table row key "install/gpt-researcher" is declared twice at the same level`;
单独 show 任一 Experiment 都正常。两个 Experiment 父行各带一个同名 eval
子行本是合法层级(行 key 只要求同层唯一)。web 面正常,只有 text 面炸。
回归入点 55054f4a(report: 原语 + sources 取代专用件)。

## 根因

`resolveTableContent` 同时产出两套行投影:层级 `content.rows`(权威)与
text 排版用的展平 `rows`。校验 `validateResolvedTable` 在 web / text 两个
face 里各调一次,靠**可选第三参** `hierarchyRows` 决定拿哪套判重——web
调用点传了,text 调用点漏传,于是 text 面把展平后的行当同层判重,
不同父行下的同名子行撞 key。这是 CLAUDE.md「可选字段要数着调用点过」
的又一实例:可选参数漏传是合法省略,类型系统拦不住,单层表格全绿。

## 修法

不补第三参,拆掉双投影(`src/report/definition/primitives.tsx`):

- `tableContentOf`(修复时叫 `resolveTableContent`,同日按「概念命名不用 Resolve 词族」
  改名)只产出唯一权威形态 `{ columns, content }`,
  校验(`validatedTable`)在 resolver 内做一次,可选参数消失;
- text 面在渲染期自己调 `flattenTableContentForText`,展平不再进权威形态;
- 顺带删除 web 面不可达的 `content === null` 旧分支(resolver 恒产出
  content,空列在校验就抛)与恒假的 stray-cell 检查(展平只按声明列生成
  格子,该检查自 55054f4a 起就是死码)。

回归测试在 `src/report/definition/table.test.tsx`
(「两个父行各带同名子行」两面渲染 + 同层真重复仍报错),
覆盖类别登记在 `docs/engineering/testing/unit/reports.md` Table 条目。
适用场景:一份数据要喂两个 renderer 时,派生投影在消费端做,
不要在 resolver 里预烤第二套并列返回——并列返回迟早有调用点选错。
