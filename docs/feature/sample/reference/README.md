# Sample —— 参考方案

这一层为什么存在、为什么长这样。读法:决定「要不要加一个算子」时看这里。

## Vega-Lite —— 三层切法与有限算子

**是什么。** 声明式可视化语法。一份规格分成 `data` → `transform[]` → `mark` + `encoding` 三段:
数据从哪来、怎么变形、画成什么。`transform` 是一个**可枚举闭集**——`filter`、`aggregate`、`bin`、
`window`、`joinaggregate`、`fold`、`pivot`、`lookup` 等,每个都是 JSON 对象,完全可序列化、可静态
分析。Vega-Lite 本身编译成更底层的 Vega dataflow 图,形成「上层受限好写、下层强大」两级。

**学了什么。**

- **中间层的存在本身。** Record → Sample → Reports 就是 `data → transform → mark`。原本
  「选口径」挤在事实层、「算覆盖」挤在报告层,两边都得为它写规矩;分出来之后事实层只剩事实,
  报告层只剩呈现。
- **算子是闭集,不是表达式语法。** [`pipe`](../library.md#转换pipe-与算子闭集) 的算子表可以逐条
  列举,`filterAttempts` 是唯一的函数出口,其余全是可序列化声明。这让一条 pipe 能被记录、比较、缓存,
  也让「用户想要一个官方组件不支持的变体」有泄压阀而不长成语言。

**没跟什么。**

- **`aggregate` 那一支没抄。** Vega-Lite 的 transform 含聚合,而 Reports 的
  [指标](../../reports/library/measures.md)已经有 `perEval` / `acrossEvals` 两级聚合与维度选轴,
  比通用 `groupBy` + `reduce` 更贴 eval 的语义(题级折叠与跨题折叠本来就是两回事)。同一件事两个
  地方能做,两边迟早给出不同的数,所以 Sample 只删减、不聚合。

## Grafana —— 同一层的另一种做法,以及一个反面

**是什么。** 观测面板系统。数据流是 datasource query → **transformations** → panel;
transformations 是一串可组合的变换(filter / groupBy / join / reduce / organize),在 UI 上按顺序
叠加。所有 datasource 归一化成 **DataFrame**(统一的列式表),所有 panel 消费 DataFrame——于是
panel 与数据源完全解耦。

**学了什么。**

- **变换链作为一等公民。** 「取数」与「呈现」之间确实需要一层可组合的东西,这个判断被 Grafana
  的十年演进反复验证。
- **口径统一成一种中间表示。** `sample.attempts` 扮演的就是 DataFrame 的角色:所有下游组件消费
  同一个已物化的集合,不各自展开来源。

**没跟什么,以及一个明确的反面教材。**

- **不做通用 DataFrame。** Grafana 的 frame 是无类型的列集合,换来 M×N → M+N 的解耦,代价是
  panel 拿到 frame 后要自己猜哪列是什么。Sample 的成员是 `AttemptHandle`,类型完整、能回到证据。
  eval 结果的形状是已知且稳定的,不需要为「任意数据源」付这个代价。
- **模板变量是要避开的终局。** Grafana 的 `$var` / repeat / 嵌套变量逐渐长成了需要自己一套求值
  规则文档的半个语言。这是「给用户更多自由」的失败模式:失败不在积木不够,在积木变成了编程语言。
  Sample 对此的两条防线是算子闭集与「只删减不替换」——[`pipe`](../library.md#转换pipe-与算子闭集)
  里没有「换成上一个完整 Run」这类重挑,要那个就回 `exp.runs` 自己挑,挑出来的裸数组不带挑选过程。

## Notebook 家族(Jupyter / Observable)—— 自由度的代价

**是什么。** 任意代码 + 输出内联。Observable 更进一步做了 dataflow 反应式重算。

**学了什么。** Observable 的 cell 依赖图说明了「谁依赖谁显式化」才能做增量重算;Sample 的
`pipe` 保持纯函数、原样本不可变,是同一个前提。

**没跟什么。** notebook 的自由度导致不可复现、不可静态分析——一份 notebook 的结果依赖执行顺序与
当时的内核状态。Sample 的选择过程必须是**确定性且可复述的**:同一个记录根 + 同一条 pipe 恒得到
同一批 attempt,`mode` 字面写在数据上。这是官方报告的数字能被别人复算的前提。

## 统计抽样 —— `Sample` / `coverage` 这两个词

**是什么。** 从总体(population)里取样本(sample),样本能不能代表总体要单独交代。

**学了什么。** 命名直接取自这里,而且取得成立:`sample.attempts` 是样本点,
[`coverage`](../library.md#覆盖是逐行的事实) 说的正是「总体里有多少没被这份样本覆盖」,
`warnings` 说的是「这份样本哪里不可靠」。三者在同一个隐喻下自洽。

对照被否决的候选:`Scope` 读作「范围」,`scope.coverage`(范围的覆盖)是同义反复,而且 `Scope`
在本仓库里已经被 Effect 的资源作用域与 `FailureScope` 占用,同一个词指三件事。命名裁决的完整
记录在 memory。

**没跟什么。** 统计学的 sample 通常含随机性,这里的选择是完全确定的。借的是「样本 vs 总体」这组
关系,不是抽样方法。

## 相关阅读

- [Library](../library.md) —— 这些取舍落成的 API。
- [Record 的参考方案](../../record/reference/README.md) —— 事实层从哪里学。
- [Reports 的参考方案](../../reports/reference/README.md) —— 呈现层从哪里学。
