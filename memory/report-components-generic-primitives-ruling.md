# report-components-generic-primitives-ruling

## 裁决

2026-07-25(用户定案,选项「全面通用化」):报告组件从「一个能力一个具名组件」改成三层——
**原语**(形状封闭,少数几个) / **数据源**(一个能力一个,领域知识全在这里) / **食谱**(具名默认装配)。
落点 `docs/feature/reports/components/`:`README.md` 三层模型 + `primitives/` 八篇 + `sources/` 目录 + `recipes/`。
执行计划 `plan/report-components-generic-primitives.md`。

## 卡点是证据,不是列

讨论一开始的问法是「实体列表能不能开放选列」,那是**错的问法**。真正拦着通用化的是通用原语的
单元格类型太弱:`Table.cells` 是 `Record<string, string | null>`、`Stat.value` 收格式化字符串,
`layout.md` 甚至明写「不能为了得到这种外观把 `MetricCell` 降成几段丢失证据的字符串」。
`MetricCell` 带 `samples` / `total` / `refs`,一压成 `string` 就断了下钻链——所以每个能力只能
各自出一个组件在内部保住它。

修法是把单元格升成判别联合 `Cell`(`metric` / `verdict` / `score` / `summary` / `locator` / `text` /
`notApplicable` / `missing`)加 `Row.subRows` 递归。升完之后 31 个具名数据组件里的大部分
自然塌进 8 个原语,`*Data` 函数一个不减地留下来。

两条容易踩的分辨:`notApplicable`(这个读数对这行没意义)与 `missing`(本该有却没跑到)不许合并成
一个空格子,合了覆盖缺口就从表里消失;占位行没有样本,给它 `samples: 0` 的 `metric` 格等于宣称
「测过、测不了」。

## 推翻了什么

推翻 [[report-components-unified-component-tree]] 里「实体列表开放选列」的否决。当时的理由是
「主读数列由题型自动切换,开放选列等于要求作者维护那个分支」——这条在新模型里失效:切换住在
数据源的 `columns(rows)` 里,作者写不写 `<Column>` 都不碰它。

同时**放弃**「组件没有旋钮」这条一致性保证:默认列序改由「大家都用默认食谱」保证。
这是实打实的放松,用户在被告知这一点后仍选全面通用化。

「组合组件不收结构子节点」那条**保留**,只是改叫食谱。

## 通用不掉的四个

`SourceView`(逐行着色 + 行内展开 + 分数 pill + 中止后降灰)、`Conversation`、`DiffView`、图表族。
前三个的渲染行为本身就是契约,没有任何表格/网格/树能表达;图表族本来已是通用词汇。
`Hero` / `HeroCard` / `PoweredBy` 留在站点身份件,理由是它们渲染品牌不是数据。

相关:[[report-components-unified-component-tree]](被推翻的那一半)、
[[report-page-level-color-assignment]](色分配单位仍是页,未受影响)、
[[group-matrix-dedicated-component-decision]](组维度不成报告行维度,与本裁决一致)。
