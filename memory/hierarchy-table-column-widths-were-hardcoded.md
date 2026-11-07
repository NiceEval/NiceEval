# 层级表列宽写死:七列同宽、结果列折行,余下几列大片留白

## 现象

`niceeval view` 的实验对比表(8 列层级表)在 1440px 宽的窗口里,除首列外的 7 列宽度**逐像素相等**
(实测各 139px):`模型` / `Agent` 这种十几个字符的值和 `通过率` 这种 5 个字符的值占一样宽,
最长的 `结果` 列(`10 通过 · 1 失败 · 1 错误`)反而装不下、折成两行把行高撑高一截。

## 根因

层级表的 web 面不是浏览器排版的 `<table>`:每层行都是 `<details>` / `<div>`,行与行之间没有
表格上下文,所以列宽当时靠**每行各自复读同一份 grid 列模板**来对齐。那份模板写在
`hierarchyGrid()` 里,除首列外一律 `minmax(105px, .68fr)` —— 列宽因此是按列位写死的常数,
和这一列真正装什么无关。同一份常数还要伺候实验对比表、逐题明细、稳定性矩阵等**列数与列
内容都不同**的表,任何一组数字都只对写它时的那张表成立。配套的 `min-width: 1080px` 又让窄
窗口无条件横向滚动。

## 修法

改成整表**一个 grid**,表头与每一层行用 `grid-template-columns: subgrid` 挂上去,列宽由全表
内容算一次:首列 `minmax(15rem, 1fr)` 吃余量,其余列 `fit-content(20rem)` 贴内容并封顶
(`src/report/definition/primitives.tsx` 的 `hierarchyGrid()` + `src/report/assets/styles.css`)。
契约落在 [`docs/feature/reports/components/primitives/table.md`](../docs/feature/reports/components/primitives/table.md) 的「两面」。

三个不查真实浏览器就会踩的点:

- **subgrid 链要一节不漏。** `<table>` 到单元格中间隔着 `thead` / `tbody` / `tr` / `td` /
  `<details>` / 子行容器,**每一层**都得是 `display: grid; grid-template-columns: subgrid;
  grid-column: 1 / -1`;漏掉任意一层,那一层以下的列就自己重新算宽,展开子行时错位。
- **Chrome 的 `::details-content` 也是链上的一节。** 它把 `<details>` 里除 `<summary>` 外的内容
  包进一个匿名盒,子行因此不是 `<details>` 的直接 grid item;不给这个伪元素补一条同样的
  subgrid 规则,子行整排错位(实测偏移 400px 以上)。没有这个伪元素的浏览器里子行本来就是
  直接 grid item,两条规则同写即可兼容。`display: grid` 加在 `<details>` 上不影响折叠。
- **别用 `getBoundingClientRect()` 判 `<details>` 折没折。** 折叠态是
  `content-visibility: hidden`,子树里的元素照样返回上一次布局的尺寸,读出来像是「没折叠」;
  真相要看截图或 `checkVisibility()`。

内容自动算宽还带来一条必须补的下限:`auto` / `fit-content` 轨道会一路缩到 min-content,
`gpt-5.6-luna` 在窄窗口被拆成三行。所以每个非首列的格子有 `min-width: 5rem` 的可读下限,
装不下时整表横向滚动。

## 适用场景

任何"不能用真 `<table>`、只能用 grid 拼表"的地方(行本身要是 `<details>`、要挂 hover 背景、
要画行分隔线时都会遇到)。默认答案是 subgrid,不是给每行复读一份写死的列模板。
