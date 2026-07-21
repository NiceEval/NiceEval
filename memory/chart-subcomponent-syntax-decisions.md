# 图表子组件语法:三候选收敛为单一设计

**裁决**(2026-07-21,用户逐条定案):`docs/roadmap/report-chart-composition` 从三候选(A 自研子组件语法 / B recharts 作构建期 SVG 生成器 / C 只加三态定制阶梯)收敛为单一设计——自研子组件语法,阶梯并入为呈现定制公式;文档结构定为 README(设计)+ architecture(技术方案)+ library(逐组件遍历)+ gallery(真实图对照)。

**曾选方案与否决理由:**

- **候选 B(recharts `renderToStaticMarkup` 生成静态 SVG)**:静态 SVG 字符串没有 React 运行时,`Tooltip` 与全部交互层不工作、悬停增强仍要自研;`Legend` 布局依赖 DOM 测量,无浏览器环境不可靠;能省下的只有坐标刻度与曲线插值,抵不过引入整包依赖。原文档把「几何计算能否脱离浏览器」列为待验证前提,实际更早否决它的是交互层。
- **候选 C(只加阶梯)**:解决不了「同图混合多种呈现」与「逐 series 覆盖」两类真实报告必须能力;且 A/C 本就不互斥(recharts 两者兼有),按"互斥候选"排列是原文档的结构错误。
- **component-mapping.md 独立成页**:逐组件的 recharts 对照判定与 library 的逐组件小节同一内容两个家,用户裁决撤页,判定溶进 library 各小节。
- **「新的待裁决点」中间态**:用户裁决 roadmap 文档不留待裁决清单,当场定案——不设 facet 容器(JSX map 已覆盖)与跨面板集中共享图例(稳定散列同色承担一致性);堆叠柱顶总值标签是堆叠呈现的默认组成部分;`by`+`value` 合并算法 = by 展开全域、value 按键精确匹配覆盖、域外/重复键报错(沿 `DeltaTable` 字面 a/b 精确匹配先例)。文档表述规则:不写「现状做不到」,超出设计范围的功能写「设计上不支持 + 理由」。

**日期与落点**:2026-07-21;`docs/roadmap/report-chart-composition/{README,architecture,library,gallery}.md`。
