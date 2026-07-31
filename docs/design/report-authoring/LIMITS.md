# 约束与候选方案

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [DECISION](DECISION.md)

---

## 目的

记下四类候选作者面各自能做什么、做不到什么，以及它们共同撞上的那几堵墙。
结论在 [DECISION](DECISION.md)，这里只写现状。

---

# 候选项 1：通用原语 + 类型化数据源

## 产品特性

原语只认[单元格类型](../../feature/reports/components/README.md#单元格类型)与结构，不认领域概念；Source 把「怎么从 `.niceeval` 取数、聚合并投影事实」打成一个具名 TS 值。
作者要么把数据源交给原语，要么先 `compute()` 再把结果交给原语。

## 当前支持

- 一个 `Table` 同时画实验对比、成绩单与稳定性矩阵，换的只是数据源。
- 两级聚合、覆盖率、证据引用由 `Measure` 与 `MeasureCell` 的形状强制携带。
- 单位、方向与格式化随 `Measure` 一次声明；双语 label 由 Component 的内建字段词典或显式呈现声明负责。
- 作者写的 Source 与官方 Source 同形态，唯一公开接口是 `Source<Input extends SourceInput, Content>`。
- `compute()` 产物是普通可序列化数据，用普通 JavaScript 就能过滤、截断、重排。

## 当前不支持

- 探索性提问要先找到对应数据源；官方目录没有的能力要作者自己写一个。
- 作者要先学会 `Measure`、`Dimension` 与两级聚合这套词汇，才能自定义读数。
- 跨实体的复杂关联（窗口、自连接、多层子查询）没有一等写法，要在 `compute()` 之后用普通 JavaScript 做。

## 直接影响

它把「容易写错的部分」搬进库：作者少写一层聚合也拿不到错数字，因为聚合层数不由作者的代码决定。
代价是作者面多一层概念，以及库要为每个能力维护一个具名数据源。
详见 [PLAN-2](PLAN-2/README.md)。

---

# 候选项 2：具名专用组件

## 产品特性

一个视图一个具名组件，取数、聚合、默认列与呈现全封在组件里。
作者按名字挑组件，用 props 调形状，例如 `<ExperimentTable>`、`<Scoreboard>`。

## 当前支持

- 上手最快：名字即意图，不学任何计算词汇就能出一页。
- 默认值最好调：每个组件独占自己的默认列、默认排序与默认呈现。
- 文档形态最直白：一个组件一页 props 表。

## 当前不支持

- 组件数随问题数线性增长，而问题本身是乘法：「按 agent 分组」与「按记忆机制分组」要么是两个组件，要么退化成一个 props 开关。
- 同名 props 会在不同组件里分叉：一个组件的 `sort` 收列 key，另一个收读数对象，作者只能逐页读文档。
- 每个新组件都要写 text 与 web 两面并各自实现降级；这是 [Sphinx 那类多渲染面系统的固有病](../../feature/reports/reference/README.md)。
- 作者要改一列必须等库加 prop，没有绕过组件的路径。

## 直接影响

它把学习成本压到最低，把演进成本堆到最高。
组件集合会随提问方式增长，而两面渲染的重复实现是这套方案的主要工程量。
详见 [PLAN-1](PLAN-1/README.md)。

---

# 候选项 3：SQL 查询面

## 产品特性

树解析时把 Record 全量加载成 attempts、evals、runs 等表，作者写 SQL 取行，通用原语渲染行集。
要落地需要一个引擎：DuckDB、SQLite，或自己实现一个 SQL 子集。

一张能摊平的 `attempts` 表大致是：

```text
run_id · experiment_id · eval_id · attempt_index
verdict · duration_ms · input_tokens · output_tokens · cost_usd
agent · model · started_at · scoring · flags(json) · labels(json)
```

## 当前支持

- 关联与窗口是一等写法：「每个 agent 上最差的三道题」一句 SQL 就能写。
- 提问不必先在库里存在对应能力，探索性查询即写即得。
- 会 SQL 的人不必再学一套词汇。

## 当前不支持

- **两级聚合退回作者手上。**
   `avg(passed)` 直接摊平 attempt，重试多的题拿到更大权重；正确写法要嵌一层 `group by`。
  两个查询都返回一个像通过率的数。
- **证据引用变成可选项。**
   聚合结果是标量，要下钻就得作者自己写 `array_agg(locator)`，忘了写就丢掉整条证据链。
- **覆盖率要靠作者自觉。**
   `count(v)` 与 `count(*)` 的差就是「测不了」的样本数；SQL 不会因为少写一列而报错。
- **artifact 摊不平。**
   diff、事件流与 trace 可达数百 MB，且逐 attempt 懒加载；把它们放入表要么在树解析前全量读入内存，要么退化成 UDF。
- **列的元数据没有位置。**
   单位、越高越好、双语标签与格式化在 SQL 里无处声明，只能在查询旁边再配一张表。
- **类型不进 TS。**
   列名拼错、类型变了都要等到运行时才炸。

## 直接影响

SQL 在「灵活提问」这条上明显赢，在 [GOALS](GOALS.md) 的正确性与可追溯两组需求上明显输：那几条需求正是靠数据形状强制的，而 SQL 的结果形状由作者当场决定。
详见 [PLAN-3](PLAN-3/README.md) 与 [PLAN-4](PLAN-4/README.md)。

---

# 候选项 4：普通值转换 + 静态 page

## 产品特性

page render 直接接收 Sample 或 AttemptEvidence，调用普通函数后把具体结果值交给组件。
两级聚合与证据由少量公共组合器保障。

## 当前支持

- 普通 TypeScript 直接表达异步、并行、join、排序与复用。
- 组件属性按值的角色命名，调用点可见 `rows`、`points` 与 `attempt`。
- 静态 page 清单保留导航、逐页惰性求值和失败隔离。
- 官方与用户 Calculation 走同一个 `rollup()` / `aggregate()`。

## 当前不支持

- 不提供细粒度的公开查询依赖图；跨 page 自动共享不是作者语义。
- 报告旁复杂算法的公式仍需单独测试，证据构造器只保证结果可追溯。

详见 [PLAN-5](PLAN-5/README.md)。

# 共通限制

## Record 不是数据库

结果是文件树：`result.json` 逐 attempt 一份，`o11y.json`、diff 与 trace 是按需读取的 artifact。
任何查询面都要先回答「什么时候从磁盘读取、一次读取多少」，而懒加载正是大 artifact 不拖垮树解析的原因。

## 结果形状不是平表

断言列表、事件流、时间树与文件级 diff 都是嵌套结构。
摊平它们要么丢层次，要么生成一堆需要关联的窄表，两条路都会把「一次 attempt 的完整证据」拆散。

## 两个渲染面

同一份声明要出终端与网页两面，且 text 面的降级形态由原语统一规定。
作者面每多一种可扩展渲染件，这条纪律就多一处可能被绕开。

## 浏览器包边界

`niceeval/report/react` 只吃已计算好的可序列化数据，不碰磁盘、不认识记录根。
查询引擎进不了这个包，所以 SQL 只能在树解析阶段执行，产物仍是行集。

## 作者已经在写 TypeScript

eval 文件、`niceeval.config.ts` 与报告文件都是 TS。
类型化数据源的拼写错误在类型检查时暴露；新增一种语言意味着新增一套报错、补全与文档。

## 双语显示

标签与摘要要按 locale 选择显示，而数值本身不能分裂。
Source Content 只带字段身份和数值语义；内建字段的本地化文案由 Component 词典承载，自定义字段在 `<Column header>` 或自定义 Component 中声明。
