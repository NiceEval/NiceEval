# 格子里的区块自带 1rem 块间距,每格比内容高出一圈

**现象**:摘要条每一格都比内容高出约 32px,矮格底部留一大片空白。散格形态下读成「六张卡各自
没填满」;合并成一片面板后仍然是行高不匀。真实产物上才看得见——单测断言的是结构与文本,不量高度。

**根因**:`.niceeval-report` 带 `margin: 1rem 0`(顶层报告区块之间的块间距),而 `Stat` 渲染的是
`<div class="niceeval-report niceeval-stat …">`。放进格子后这 16px 上下外边距照旧生效,且格子有
padding、margin 不会穿过它折叠,于是每格凭空高出 32px。`Grid` 自己算出来的 `--grid-cell-padding`
是对的,多出来的那一圈不在 Grid 的账上。

**修法**:`src/report/assets/styles.css` 加一条
`.niceeval-grid-cell > .niceeval-report { margin: 0 }`——格内留白由 Grid 给,直接放进格子的区块
不再自带块间距。任何以 `niceeval-report` 打底的组件放进格子都适用,不是给 `Stat` 打的补丁。

同类的下一个候选:别处「容器 padding + 子块 `.niceeval-report` 外边距」的组合都会有这一圈,
看到某块内容莫名比它该有的高一圈时先查这个,不要先去调容器 padding。
相关:[[grid-has-no-props-geometry-single-source]]
