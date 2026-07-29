# 报告不再有 extends:复用是普通数组展开

**裁决(2026-07-28)**:`defineReport` 移除 `extends`,`content` / `pages` 二选一。复用另一份报告
(最常见是内建 `standard`)写成 `pages: [...standard.pages]`;换掉其中一张就是
`pages: [我的页, ...standard.pages.filter((p) => p.id !== "report")]`。外壳的每个字段都由本报告
自己声明,没声明就是空——不从被复用的那份报告沿用。

**曾选方案与否决理由**

- **保留 `extends`(页归 base、外壳逐字段覆盖)**。否决:它是唯一一处「部分覆盖」——读一份报告
  文件不能确定站点最终长什么样,还要去翻 base 的外壳。而它换来的表达力,`...` 数组展开本来就有。
- **给页加内容插槽(让 `extends` 能只替换某一页的一块)**。否决:插槽是把「部分覆盖」从外壳搬到
  页里,同一个问题换个地方犯。要自由拼装就直接拼 pages 数组。

**落地注意**:`ReportDefinition.pages` 因此是公开可读面(shell.md 的字段穷尽里补了这一项)。
每份报告各自规范化自己的 pages,所以展开取到的是**等值的新页对象、不是同引用**——依赖同引用的
断言要改成 `toEqual`,页里的内容树本身仍是原来那棵(`page.content` 同引用)。旧写法不静默忽略:
命中 `extends` 抛错并给出改写指引,否则症状是「我继承的页一张都没出现」。

契约正文:`docs/feature/reports/library/shell.md`「行为约束」、`library/built-in.md`「复用有两条路」。
相关:[[grid-has-no-props-geometry-single-source]](同一轮里「不给作者留半个声明位」的另一处落地)
