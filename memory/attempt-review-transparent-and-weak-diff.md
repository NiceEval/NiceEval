---
format: concord.document/v1
id: attempt-review-transparent-and-weak-diff
title: Attempt review 透底且 diff 状态不清
createdAt: 2026-07-12T09:11:15+08:00
createdAtSource:
  kind: first-recorded
  path: memory/attempt-review-transparent-and-weak-diff.md
  commit: 6b9bcbe3e6cedbb4dc6f16a7779670386952e416
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
      [attempt-review-transparent-and-weak-diff](attempt-review-transparent-and\
      -weak-diff.md) — Attempt review
      的半透明模糊遮罩保留了报告纹理，暗色下断言行状态色又过淡；遮罩改为高不透明纯色，代码面强制不透底并提高 diff 红绿 gutter/行色对比"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# Attempt review 透底且 diff 状态不清

## 现象

暗色模式打开 attempt review 时，报告内容仍透过半透明模糊遮罩形成高对比纹理；源码断言行的红、绿、黄底色接近普通代码行，用户难以辨认 review 内容和 git diff 式状态。

## 根因

`DialogPrimitive.Overlay` 使用 `bg-black/50 backdrop-blur-[3px]`，遮罩只压暗并模糊背景，没有建立独立阅读面。代码行的 `color-mix()` 又让 panel 占 74%，暗色下状态色只剩弱提示。

## 修法

`src/view/app/components/ui/dialog.tsx` 的遮罩使用高不透明纯黑，不保留背景纹理；`src/view/styles.css` 的代码文件使用不透明 panel，pass/fail/warn 行提高状态色占比并加深行号 gutter。涉及 view 样式时运行 `pnpm run view:build`，避免只改源码未更新产物。
