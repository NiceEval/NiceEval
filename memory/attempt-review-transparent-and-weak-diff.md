# Attempt review 透底且 diff 状态不清

## 现象

暗色模式打开 attempt review 时，报告内容仍透过半透明模糊遮罩形成高对比纹理；源码断言行的红、绿、黄底色接近普通代码行，用户难以辨认 review 内容和 git diff 式状态。

## 根因

`DialogPrimitive.Overlay` 使用 `bg-black/50 backdrop-blur-[3px]`，遮罩只压暗并模糊背景，没有建立独立阅读面。代码行的 `color-mix()` 又让 panel 占 74%，暗色下状态色只剩弱提示。

## 修法

`src/view/app/components/ui/dialog.tsx` 的遮罩使用高不透明纯黑，不保留背景纹理；`src/view/styles.css` 的代码文件使用不透明 panel，pass/fail/warn 行提高状态色占比并加深行号 gutter。涉及 view 样式时运行 `pnpm run view:build`，避免只改源码未更新产物。
