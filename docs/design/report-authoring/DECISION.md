# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) ·
[PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md)

---

## 结论

采纳 [PLAN-2](PLAN-2.md) 的取数结论，并把作者面进一步收敛成两个核心概念：
**Source 负责计算 Content，Component 负责显示 Content**。不引入 SQL，也不引入按视图命名的专用组件。

两条轴各得到一个答案：

- **Source 只有一种协议。** `Source<Input extends SourceInput, Content>` 与 `defineSource(...)` 是唯一
  `.niceeval` 查询接口；输入只允许 Sample / AttemptEvidence，外部业务数据直接走 Component `data`。表格默认字段
  与 rows 由同一次 `compute()` 返回，但字段描述不含本地化 label 或布局；不存在 `DataSource` / `RowSource` 两套平行抽象。
- **Component 只有 source / data 两种用法。** 管线把 source 计算成 Content 后才进入 renderer；
  renderer 看不到 Source、Sample、Record，也没有自己的 `resolve` 取数面。
- **数据由类型化声明提供。** 读数、维度与聚合方向写在 TypeScript 里，
  作者面不出现查询语言。
- **报告树对双面 Component 开放。** 作者可以用 `defineComponent` 增加新的视觉形状，
  但必须同时实现 text 与 web renderer；只装配已有组件的宏使用 `defineComposition`。
- **名称与颜色是一份维度呈现。** `dimensions(data)` 让管线提前收集全集，renderer 通过
  `ctx.present(dimension, value)` 同时取得身份、页内唯一标签和颜色；自有页面使用 `presentDimension(...)`。
- **Summary 与 Notice 不属于 Source。** `sample.snapshot` / `attempt.snapshot` 返回中性事实；默认 KPI、
  本地化解释、严重度与动作由 Component / Composition 决定。读取 / 选择层产生可重算的
  `SampleIssue`，不把 message / command 写入 `.niceeval`；persisted diagnostics 只保存 observation。
- **格式化属于 renderer。** Measure 把可序列化 `format` 与数值语义带进 Content，不接受 locale
  formatter 回调，也不预生成 `LocalizedText`。renderer 用 `ctx.locale` 格式化同一个 value。
- **Chart 消费通用 Dataset。** `sources.measure.rows(...)` 负责维度、读数与聚合；Chart 的 x / y 与
  `<Series mark>` 负责显示。没有把 mark、axis、series 塞回 Source 的 `sources.chart(...)`。

这里封闭的是 NiceEval 承诺维护的**内建原语目录**，不是用户报告树可接受的组件集合。
新领域名词不能成为增加官方原语的理由，但作者不必为了新的视觉形状离开 `show` / `view`。

---

## 依据

### 容易写错的部分必须在库里

[GOALS](GOALS.md) 的需求 1 到 7 有一个共同点：它们描述的都是**默认就该对**的事。
两级聚合的权重、`null` 与覆盖缺口的区别、每个数字覆盖了哪些 attempt，
读者不会去检查，作者也不会每次都想起来。

PLAN-2 把这几条压进数据形状：`Measure.perEval` / `acrossEvals` 决定聚合层数，
`MeasureCell` 的必填字段决定证据与覆盖率。
作者少写什么都不会得到一个错的数字，最多得到一个不好看的表。

[PLAN-3](PLAN-3.md) 把同样几条交给作者的 `group by` 层数和 `array_agg` 写没写。
它们出错时的表现是「一个看起来完全正常的数」，
这类错误在报告里的成本最高——报告的用处正建立在数字可复算之上。

### 通用原语的可维护性靠判据，不靠克制

需求 15 要的是「新增形状有判据」。PLAN-2 的三问判据给了这个判据：
要读磁盘或认识领域概念的进数据源，要看整页数据的进管线，两个都不要的才可能成为内建原语。
「某个数据源画出来长得不一样」因此不构成加原语的理由。

作者定义的渲染组件不进入内建原语目录，也不把维护义务转给 NiceEval。它通过公开双面协议进入报告树，
与官方原语走同一条 resolve、dimensions 收集、validate 与 render 管线。

[PLAN-1](PLAN-1.md) 没有这样的判据。组件按提问方式增长，
而提问方式是维度与读数的乘积，没有收敛点。

### 入口体验不必用专用组件换

PLAN-1 唯一真正的优势是一行出一页。这个优势被组合组件接住了：
`SampleOverview` 与 `AttemptDetail` 就是具名的默认装配，
区别是它们只装配公开原语、不接受结构子节点、并给出可照抄的等价全文。
作者从「一行」走到「逐块改」不换心智模型，
[PLAN-2 的五级改法](PLAN-2.md#五级改法一级比一级深)每一级都不需要库先加一个 prop。

组合组件由 `defineComposition` 定义。`defineComponent` 留给真正产生新渲染形状、同时实现两面的组件，
避免一个叫 component 的 API 实际只能返回其它组件。

### 灵活提问由普通 JavaScript 承担

需求 8 的长尾部分不需要一门语言。`compute()` 的产物是普通可序列化数据，
排序、截断、分组、关联都是几行 JavaScript，而且带类型检查与断点。
SQL 在这条上的优势是语法更短，代价是引擎依赖与第二条口径入口。

---

## 否决的候选项

### 否决 PLAN-1（具名专用组件）

- 违反需求 9：改一列要等库加 prop，作者没有绕过组件的路径。
- 违反需求 11：每个组件自己算聚合，同一个读数在两处是两段代码。
- 违反需求 15：组件集合没有闭合判据。
- 撞上 [LIMITS 的两个渲染面](LIMITS.md#两个渲染面)：
  每个新组件都要写两面并各自实现降级，这是多渲染面系统最常见的失败点。

### 否决 PLAN-3（SQL 取数）

- 违反需求 1：直觉写法是摊平的 `avg`，重试多的题拿到更大权重。
- 违反需求 5、6：证据引用与覆盖率降级成作者可选的列。
- 违反需求 12：列的单位、方向等数值语义只能散在查询旁边。字段身份也无法成为 Component
  呈现词典稳定匹配的类型化值。
- 撞上 [artifact 摊不平](LIMITS.md#record-不是数据库)：
  全量物化违反需求 17，UDF 等于给 `Measure.value` 包一层语法还丢掉 `null` 语义。

### 否决 PLAN-4（SQL 逃生舱）

- 违反需求 11：同一页上两个数可能来自两条口径，读者无从判断谁对。
- 把「数字能回到证据」从必然降级成可选。
  一条规则在同一份契约里有两种强度时，较弱的那种会成为事实标准。
- 引擎依赖按是否引入计算，不按使用频率；4a 与 4b 都要引入。
- 4b 这个受限形态能做的事，[PLAN-2 的普通 JavaScript 加工](PLAN-2.md#取数与加工分开)
  已经能做，且多两行代码换来类型检查。

---

## 契约落点

决策本身到此为止，产品要满足的契约写在功能文档里：

- Source / Component 核心模型、进阶组合与单元格类型：[组件树](../../feature/reports/components/README.md)。
- Source 的唯一公开接口、领域目录与三条纪律：[Source 目录](../../feature/reports/components/sources/README.md)。
- 读数、维度与两级聚合：[读数与维度](../../feature/reports/library/measures.md)。
- 作者的五级改法与嵌入自有页面：[Library](../../feature/reports/library.md)。
- 管线、可序列化边界与两面同源：[Architecture](../../feature/reports/architecture.md)。

---

## 遗留风险

- **探索性提问仍然要写代码。** 触发条件是同一段
  「`compute()` 加 JavaScript 加工」在三份以上报告里重复出现。
  后续动作是把它收编成一个具名数据源，不是补一门查询语言。
- **数据源目录会长大。** 触发条件是读者在目录里找不到自己的问题。
  后续动作是维护 [Library 的「按问题选择」表](../../feature/reports/library.md)
  作为单点入口，而不是按字母排列的清单。
- **单元格类型的增长会波及全部原语。** 触发条件是有人提出新的 `Cell` kind。
  后续动作是先过三问判据，再确认它无法表达成已有 kind 的组合。
- **作者仍要学一层词汇。** 触发条件是新用户在自定义读数上卡住。
  后续动作是补组合组件的等价全文与场景示例，
  不是把 `Measure` 换成字符串参数——那条路会退回 PLAN-1 的反指标。
