# Reports —— 参考方案

呈现层要同时做到三件事:组件可编程、数据与渲染分离、一份定义出终端和网页两个面。**三条全占的
先例找不到**——每个参考物只覆盖一到两条,所以这一层是逐块借的,接缝自己设计。下面记下借了谁的什么。

## Rich(Python)—— 双面渲染能走多远

**是什么。** 终端渲染库。任何对象实现 `__rich_console__` 协议就是一个可渲染件;布局(Table 列宽
计算、换行、截断)在产出 `Segment`(文本 + Style)流之前完成,终端 writer 把 Style 转 ANSI。
`Console(record=True)` 之后 `save_html()` / `save_svg()` 把同一次渲染导出成网页。

**学了什么。**

- **两面共享 Content，而不是共享终端画面。** 原语的 text / web renderer 消费同一份
  可序列化 Content。
- **共享层在布局决策之前。** Rich 把「排多宽」放在共享层、把「怎么涂色」放在面里。

**没跟什么,而且是有意的。**

- **不共享几何结果。** Rich 的共享层是 Segment 流——已经定好了字符宽度。niceeval 的两面共享的是
  [节点顺序、分组、字段终值与降级不变量](../architecture.md#排版原语的语义层与面内布局),各面再用
  自己的宽度单位排版(终端显示列 vs CSS container inline size)。理由:Rich 的 HTML 导出本质是
  「把终端画面贴进网页」,等宽字体、固定列宽;而 view 要的是真 DOM——响应式减列、CSS grid、可点击
  的列头。把几何提到共享层就等于让网页永远长得像终端。
- 所以 `NormalizedGrid` 只到「有序、不可拆的 cell 列表 + columns / variant / density」,
  `TextGridPlan` 是 text 面自己的产物。

## Textual —— 另一条路,以及为什么没走

**是什么。** Python TUI 框架,建立在 Rich 之上。`textual serve` 能把同一棵 widget 树跑在浏览器里,
布局用 TCSS。

**没跟什么。** Textual 的 web 面是**终端渲染的远程投影**——浏览器里跑的仍是终端画面。这条路便宜
得多(一份渲染代码),但 `sources.entity.experiments` 在 view 上要可排序、可过滤、能点开 attempt 详情,那是原生
DOM 语义,投影给不了。所以这里选了更贵的「两个原生渲染面」,代价就是上面 Rich 那条的取舍与本页
`enhance` 契约的全部复杂度。这是一次明确的取舍,不是漏做。

## Sphinx —— 多 builder,与它的固有病

**是什么。** 文档生成器。一份 reStructuredText 解析成 doctree,再由 `html` / `text` / `man` /
`latex` 等 builder 各自渲染;directive 是用户可注册的组件,extension 给自己的 directive 写各
builder 的 visitor。这是「用户可编程组件 + 多渲染面」最老牌的真例。

**学了什么。** 语义树与渲染面分离。

**它的病,以及这里怎么防。** Sphinx 的第三方 directive 常常只实现 html visitor,text builder 上
就报错或输出空白。这是「双面 × 用户可编程组件」的固有失败模式。NiceEval 不以封闭报告树回避它，
而是在 `defineComponent` 协议上设三道防线：

1. `text` 与 `web` renderer 都是必填字段，缺一面时组件定义失败。
2. 两面只能消费同一份可序列化 resolve data，renderer 同步且不能重新取数。
3. **[具名 `enhance` 位](../architecture.md#只有一面能做的事具名-enhance-位)** 挡住更隐蔽的一半：
   两面都写了,但 web 面能看到的信息在 text 面悄悄少了。每个能力位的 text 降级形态有明确约束。

## Evidence.dev —— 命名查询与构建时取数

**是什么。** BI-as-code。markdown 页面里写**命名的** SQL 代码块,组件按名字引用:
`<BarChart data={orders_by_month} x=month y=total/>`。构建时执行全部 query 落成 parquet,渲染时
不碰数据库。

**学了什么。**

- **计算声明可以复用。** 同一个 TypeScript source 值能被多个原语或 page 直接引用；
  一次 page resolve 内按 source 对象与 input 引用记忆化，不增加字符串查询注册表。
- **取数与渲染在管线上分离。** 组件渲染面不读文件,这条两边一致。

**没跟什么。** Evidence 的查询语言是 SQL,数据源是数据库。这里的数据源用 TS 声明,因为
输入是 `AttemptHandle` 这种带懒加载方法的对象,不是行集——把 eval 结果压成 SQL 表会丢掉「下钻到
证据」这条主线。

## Vega-Lite —— 有限算子而不是表达式语法

**是什么。** 声明式可视化语法,`data → transform → mark`。

**学了什么。** 三层切法本身(见 [Sample 的参考方案](../../sample/reference/README.md)),以及
**给用户的自由度必须是可枚举的**。这条在呈现层的落点是组件树与 `enhance` 闭集:报告树是声明式
结构,不是能求值的表达式。

**没跟什么。** `aggregate` 那一支没抄成 Sample 的算子,而是留在 Reports 的
[读数](../library/measures.md):`perEval` / `acrossEvals` 两级聚合比通用 `groupBy` 更贴 eval 语义
(题级折叠与跨题折叠本来就是两回事)。

## Grafana —— 面板生态的反面教材

**是什么。** panel 插件 + datasource + transformations + dashboard JSON。

**学了什么。** panel 与数据源解耦的价值；范围级数据源统一消费 `Sample`，attempt 详情显式消费
`AttemptEvidence`，原语只看 Content。

**没跟什么。** Grafana 的模板变量(`$var` / repeat / 嵌套)逐渐长成需要独立求值规则文档的半个
语言。这是「搭积木」的失败模式:失败不在积木不够,在积木变成了编程语言。这里的对策是所有扩展点
都是闭集或类型受限的构造函数,报告树里没有字符串插值求值。

## Storybook(CSF)—— 已经买下、值得兑现的红利

**是什么。** 组件与其数据样例同处一文件,组件可脱离真实数据源独立渲染。

**这里的对应物。** [data 形态](../library.md#数据计算与缓存边界)与
`niceeval/report/react`(只导出纯 renderer、不含取数)合起来意味着:把数据源算出的 Content 存成 fixture
JSON,纯 renderer 吃 fixture,**报告组件可以做视觉回归测试,完全不跑 eval、不碰磁盘**。
`architecture.md` 里「source 形态与手工调 `compute()` 再传 `data` 严格等价」这条契约正是
这套测试成立的前提。同一批 fixture 还能当组件文档的活例子。

## Remix / RSC —— loader 与 server/client 边界

**是什么。** route 声明 loader,框架并行调用后把序列化数据交给组件;RSC 用 server/client 组件边界
表达「哪些代码不进浏览器」。

**学了什么。** resolve 阶段并行计算数据源、作者不写取数管道,就是 loader 模型;
`niceeval/report` 与 `niceeval/report/react` 的切分就是 server/client 边界——`Run` 类型进不了
浏览器,`sources.run.diagnostics` 的 data 形态只带 experimentId / startedAt / DiagnosticRecord[]。

**没跟什么(暂时)。** Remix 后来演进出的 `defer` + streaming 还没有对应物:现在是全部数据源
并行完成才渲染。`diff.json` 可达百 MB,view 上迟早要「先出实验列表,重证据后到」——那时抄的就是这条。

## 相关阅读

- [Architecture](../architecture.md) —— 这些取舍落成的两宿主与双面契约。
- [Library](../library.md) —— 落成的组件与取数 API。
- [Record 的参考方案](../../record/reference/README.md) —— 事实层从哪里学。
- [Sample 的参考方案](../../sample/reference/README.md) —— 选择层从哪里学。
