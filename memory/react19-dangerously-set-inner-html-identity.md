---
format: concord.document/v1
id: react19-dangerously-set-inner-html-identity
title: React 19 的 dangerouslySetInnerHTML 只比对象身份，重渲染即重建子树
createdAt: 2026-07-16T17:34:49+08:00
createdAtSource:
  kind: first-recorded
  path: memory/react19-dangerously-set-inner-html-identity.md
  commit: e02cdce4d18fbab221373c1dcfb32cad95060ad7
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
      [react19-dangerously-set-inner-html-identity](react19-dangerously-set-inn\
      er-html-identity.md) — React 19 对 dangerouslySetInnerHTML 只比 `{__html}`
      对象身份,内联字面量让任何重渲染都整树重建报告槽(开关 attempt 弹窗丢 details/排序/过滤状态);修为 useMemo 包
      `{__html}`(`src/view/app/App.tsx` 的 ReportSlot)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# React 19 的 dangerouslySetInnerHTML 只比对象身份，重渲染即重建子树

## 现象

view 的报告槽（`.report-slot`，静态 HTML 经 `dangerouslySetInnerHTML` 摆进去）在任何一次 App 重渲染后整个 DOM 子树被重建：打开/关闭 attempt 弹窗（`#/attempt/@…`）后，用户在报告里展开的 `<details>` 全部折回、排序和过滤状态丢失。看起来像"关掉 modal 把外面刷新了"。给 `Element.prototype.innerHTML` setter 打桩可见 React commit 阶段用**一模一样的字符串**重设了同一个节点的 innerHTML。

## 根因

React 19（实测 19.2.7）删掉了 render 阶段的 prop diff：`updateProperties` 对 `dangerouslySetInnerHTML` 只做 `nextProp !== lastProp` 的**对象身份**比较，身份变了就走 `setProp` 无条件 `domElement.innerHTML = value.__html`——不再像 React 18 那样比较 `__html` 字符串值。JSX 里内联写 `dangerouslySetInnerHTML={{ __html: html }}` 每次 render 都新建对象，所以宿主组件任何一次重渲染都触发重设，即使字符串完全没变。浏览器重新解析 HTML，原 DOM 节点全部换新，用户浏览状态（details open、滚动、临时 class）全丢。

## 修法

把 `{ __html }` 对象 memo 住，身份不变就不会进 `setProp`：

```tsx
function ReportSlot({ html }: { html: string }) {
  const markup = useMemo(() => ({ __html: html }), [html]);
  return <div className="report-slot" dangerouslySetInnerHTML={markup} />;
}
```

落点 `src/view/app/App.tsx`（2026-07-16）。适用场景：所有 React 19 下的 `dangerouslySetInnerHTML`，凡是槽内内容带用户可变浏览状态（details / 表单 / 滚动容器）或体积大到重解析有感的，一律 memo `{__html}` 对象；纯静态小片段（如内联 SVG 字标）重设无感，可不管。
