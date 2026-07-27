# 变更方案（第一批）：Reports 作者模型与页级呈现

对 `bcb82b60` 的逐条拷问结果。**本文件只记问答与变更清单，不承载契约正文**——契约改进
`docs/`，全部批次收口后本文件收敛成 `memory/` 裁决条目并删除。

五个批次现已全部有裁决。台账保留问答与理由；契约正文在 `docs/`，裁决摘要在 `memory/`。

批次划分与依赖：

| 批次 | 主题 | 状态 |
|---|---|---|
| 1 | Reports 作者模型闭环（Q1 / Q2 / Q3 / Q7 / Q8、H1 / H2 / H4 / H5） | 本批，除外部数据入口外闭环 |
| 2 | 维度呈现闭环（Q4 / Q5 / Q6） | 本批 |
| 3 | 外部业务数据怎样进入报告（H3 派生） | 已闭环：冻结快照 `ctx.data` |
| 4 | Issue / Notice 闭环（Q9 / Q10） | 已闭环：`NoticeCatalog` 单源 |
| 5 | Record 契约修复（位宽、碰撞、`runId`、schemaVersion） | 已闭环：保留 11、60 bit、补碰撞语义 |

状态：`已定稿` 可直接改 docs ／ `待答` 有明确的下一问 ／ `待裁决` 需要用户拍板。

---

## 一、Composition 是第三个作者概念

### Q1 `defineComposition` 到底能不能 `await`？

`architecture.md` 声明 `(props, ctx) => ReportNode`（同步），`layout.md` 与 `examples.md`
两处示例都写 `async (props, ctx) => {...}`。同一句话里还承诺它"可以并行计算"。

**A（已定稿）** 签名统一为返回 `MaybePromise<ReportNode>`，Promise 只在 resolve 阶段 await。

```ts
type MaybePromise<T> = T | Promise<T>;

interface CompositionContext<Input extends SourceInput> {
  readonly input: Input;
  readonly page: NormalizedPage;
  readonly signal: AbortSignal;
  resolve<Content>(source: Source<Input, Content>): Promise<Content>;
}

function defineComposition<Props, Input extends SourceInput = Sample>(
  expand: (props: Readonly<Props>, ctx: CompositionContext<Input>) => MaybePromise<ReportNode>,
): Composition<Props, Input>;
```

管线格位：load 只校验品牌不调 `expand`；resolve 调 `expand` 并 await，再递归展开返回的子树、
执行其中的 Source；validate 之后的三格都作用在展开后的完整树上。同层可 `Promise.all`，
结果按声明顺序装回。

Composition 不进 Source memo：一个 Composition **节点**在一次 page resolve 执行一次，
text / web 共用同一次展开结果。

`ctx.resolve(source)` 与 `<Table source={source}>` 共用同一个 page 级缓存，键是
`Source 对象身份 + input 对象身份`，**缓存的是 Promise 而不是完成值**——并发请求因此只计算一次，
成功与失败由同一个 Promise 广播给本页全部消费者。缓存生命周期止于 page resolve 结束。

### Q2 作者的 `await` 住在哪里？外部数据 join 怎么写？

`sources/README.md` 教的加工写法 `const content = await budgets.compute(sample)` 在报告文件
顶层没有 `sample`，照抄即 `ReferenceError`。而"NiceEval 读数 join 外部业务数据"这个第一常见
场景，在"只有 Source 和 Component"的模型里没有位置。

**A（部分定稿）** await 只有两个合法产地：Composition 的 resolve 回调（经 `ctx.input`）、
报告管线之外的独立库程序（调用方自带 `sample`）。Composition 内取 Source 必须走
`ctx.resolve(source)`，不写 `source.compute(ctx.input)`——后者绕开 page memo。

**未闭环的那一半：`ctx.resolve()` 只吃 NiceEval Source。** 多个 Source 之间的 join 有了合法写法，
但「NiceEval 读数 join 我司工单系统」——本问最初用来证伪两概念模型的那个用例——仍然没有落点，
因为 H3 撤回了 Composition 里的外部 IO。这条不能算解决，见[批次 3](#批次-3外部业务数据怎样进入报告待裁决)。

因此心智模型是**三个概念**，不是两个：

```text
Source       可复用的 NiceEval 数据计算
Composition  拿到 page input，编排 Source、加工 Content、返回组件树
Component    同步显示已经 resolve 的 Content
```

Composition 不是"进阶装饰能力"。简单报告只碰 Source + Component；一旦需要多个来源、
跨来源 join 或动态树，就进入 Composition。

**同时作废**`architecture.md` 的"需要异步计算时定义 Source"——改成"可复用的 NiceEval 数据
计算定义为 Source；依赖当前 page input 的编排与跨来源 join 定义为 Composition"。

### H1 `ctx` 不能携带主题（已定稿）

原提案的 `ctx.report: NormalizedReport` 会把 `theme` / `dimensionPins` / `styles` / `scripts`
带进 resolve，直接违反 `architecture.md` 的两条现有不变量："主题不参与 resolve，它不进 `ctx`"、
"不进 `ctx.report`"。而"主题能独立分发"这条性质的唯一根据就是它不参与 resolve。

`dimensionPins` 同样不能给 Composition：能读钉色就能按颜色改变返回的树，页级色分配就不再是
纯函数。`CompositionContext` 因此只留 `input` / `page` / `signal` / `resolve`。

### H5 去重的不对称（已定稿）

同一 Composition 的两个节点各执行一次 `expand`。其中的 `ctx.resolve(source)` 命中同一 page
memo 只算一次；Composition 自己不 memo。契约里要点明，否则作者会预期 Composition 也去重。

### H2 attempt 级 Source 能否在 sample page 里取？（已裁决：不能）

`resolve` 的第二个重载 `resolve(source, input)` 里 `OtherInput` 只能是 `AttemptEvidence`，
但 `CompositionContext` 没有 `record`，拿不到 evidence——那是一个类型合法、运行时无法构造参数
的 API。

**裁决：删掉重载，`ctx.resolve` 只收与本 page 同类型的 Source。** 这不是两个平权选项之间的偏好：
另一条路要给 Composition 开 `ctx.record`，那等于让它绕过 Source 任意读盘，直接推翻 `DECISION.md`
的第一条结论「Source 是唯一 `.niceeval` 查询接口」——那是另一个量级的裁决，不能作为一个签名细节
顺手带过。

**接受的后果：`sources.attempt.*` 全家只能出现在 attempt-input page。** 要在总览页看某条 attempt
的证据，用 locator 链过去。

### 批次 3：外部业务数据怎样进入报告（待裁决）

原提案在 Composition 里直接 `await budgetClient.listBudgets()` 的示例已撤回。合法化外部 IO
会同时打破三条现有承诺：

- `SitePlan` 的"给定同一输入，同一路径最终字节恒相同"——输出还取决于远端此刻返回什么。
- `writeSite` 的全或无——为确定性失败设计的策略，现在一次 502 让整份站点导不出来。
- `show` 是 Agent 入口——`ctx.signal` 有了，但谁 abort、预算多少、超时后整页失败还是该节点失败，全未定。

**范围比外部 IO 更大。** `expand` 是一个普通异步回调，它同样能读 `Date.now()`、`Math.random()`、
环境变量与文件系统。GOALS 要的"声明式结构"和 `SitePlan` 要的字节恒等，对这几样一视同仁。所以这批
要答的不是"要不要允许 fetch"，而是**报告树的确定性边界写在哪一层**。

三个候选，各自的代价已经看得见：

| 候选 | 外部数据怎么进 | 代价 |
|---|---|---|
| A 禁止 | 不进；报告只画 `.niceeval` | 最初那个 join 用例直接不支持，作者只能自己写 React 页面 |
| B 构建前确定性快照 | 跑报告前先把外部数据落成一份可序列化快照，`--data <file>` 或 config 注入，`ctx` 只读快照 | 字节恒等保住；多一个准备步骤，快照的新鲜度归作者 |
| C 允许 IO + 显式非确定性标记 | Composition 声明 `nondeterministic: true`，`--out` 对这类 page 关闭字节恒等承诺 | 承诺分裂成两档，读者要知道自己看的是哪一档 |

倾向 B：它同时答了外部 IO、时钟与随机数三件事，也不需要给 `SitePlan` 的承诺开例外。
**需要用户裁决。**

### H4 Composition 的 `Input` 与 page input 不匹配谁拦（已裁决：装载期）

`Composition<P, AttemptEvidence>` 可以被写进 sample page，类型系统拦不住跨 page 的装配。

**裁决：`Input` 记在节点品牌上，装载校验页列表时比对 page 的 `input` 声明并报错。** 不能等到
resolve——那时 `expand` 已经拿着错类型的 `ctx.input` 跑起来了，错误会从作者代码内部冒出来
（`ctx.input.attempts is undefined` 之类），而不是指向那次错误的装配。

---

## 二、单元格类型不是全局协议

### Q3 `Cell` 还是"原语与数据源之间的全部接口"吗？

不是。`defineComponent<Data, Options>` 的 `Data` 是任意可序列化类型，报告树对作者渲染组件
开放之后这句话就成了假命题。

**A（已定稿）** 删掉"全部接口"这句。全局协议只有 `Source<Input, Content> → Content → Component`；
`Cell` 降级为**官方表格数据协议的标准值封装**：

- 自定义 Source 配自定义 Component：任意可序列化 Content，不要求 Cell。
- 自定义数据交给官方 `Table` / `Chart`：必须适配成它们声明的 `TableContent` / `Dataset` / `Cell`。
- 官方 Measure Source：用 `MeasureCell`，保留 value / format / 覆盖 / refs。

单元格类型整节从 `components/README.md`（总纲）搬到 `primitives/table.md`（官方表格协议的家）。
`sources/README.md` 与 `stat-grid.md` 只链过去，不复制第二份。

---

## 三、页级维度呈现

### Q4 `dimensions()` 为什么可选？

漏写不报错，后果是静默串色：该组件的值没进页级 keyset，而 GOALS 13"同一维度值在一页里恒定
一个颜色"是硬目标。单组件 fixture 全绿，两组件同页才露馅。违反 CLAUDE.md 自己的"能做成必选
就别做成可选"。

**A（已定稿）** 改必填。不消费维度的组件显式写 `dimensions: () => ({})`——这一行的作用是逼作者
回答"该组件参不参与页级身份分配"。

配套运行时封闭性：`ctx` 只能查询本组件 `dimensions()` 已声明的值，未声明的查询抛
`UndeclaredDimensionValueError`，不临时分配颜色。漏写因此从"静默串色"变成"立即失败"。

fixture 义务落在 `docs/engineering/testing/unit/reports.md`：每个自定义组件 fixture 必须
**同时**执行 text 和 web renderer，并证明两面查询未声明的 dimension / value 都会失败。只跑
text 面抓不到 web renderer 偷用未声明值——text 面不消费颜色，可能根本不调查询。

### Q5 六个色槽超容量

第七个 series 起静默复用颜色，让图说谎。`dimensionPins` 只稳定映射、不增加容量，不是解法。

**A（部分定稿）** 升级为组合视觉编码，官方容量 `6 主题色 × 4 形状变体 = 24 个可区分身份`，
超过 24 在编码规划阶段拒绝该 page。已定的五条：

| 编号 | 决定 |
|---|---|
| ① | 容量与槽位按**页级 visual keyset**判定，不按组件内重新编号——接受"只画 3 条线的组件可能因同页其它 visual consumer 已占用前序身份而拿到高 variant"，换页内同一值视觉身份恒定 |
| ② | 分别维护页级 **label keyset** 与 **visual keyset**；label-only 消费者（如 27 行的表）不参与色槽分配，visual keyset 是所有 color / series consumer 声明值的并集 |
| ③ | 非颜色通道从 series 1 起就参与，放弃"前六条全部 solid / circle"的视觉简洁——理由是可辨性不能 100% 押在颜色上，6 色对常见色觉缺陷本就不够 |
| ④ | 容量只在 **web 编码规划**时校验；collect dimensions 拆成两面共享的 label 收集与 web-only visual planning。text 面不上 ANSI 色，只输出自足的 label 与文本符号 |
| ⑤ | 超容量错误只保留 filter 与 split / facet 两个**真实**下一步；删掉"provide a custom component encoding"——公开面给不出第 25 个身份，那是空头支票，违反 error-feedback 的核心契约 |

不同 mark 投影同一个 variant 序号：

| Variant | Line | Scatter | Bar / Area |
|---|---|---|---|
| 1 | solid | circle | solid |
| 2 | dashed | square | diagonal |
| 3 | dotted | diamond | dots |
| 4 | dash-dot | triangle | crosshatch |

图例必须画完整编码（色 + 线型 / 形状 / pattern），不能继续只画一个色点。

**四条收口（已定稿）：**

1. **查询形态定为 handle / index，删除按值查。** `dimensions()` 返回具名声明
   （`{ dimension, encoding, values }`），renderer 用 `ctx.dimension(handle).at(index)` 取。
   复合键（`` `${agentId}/${model}` ``）因此只在 `dimensions()` 里派生一次，两处派生逻辑
   不可能分叉。
2. **1→24 的分配序列写死**，色与 variant 同时递进：`c1/v1, c2/v2, c3/v3, c4/v4, c5/v1,
   c6/v2, c1/v3, …`。24 个 `(色, variant)` 组合两两不同（逐对验过）。
   **照实写上界**：变体只有 4 个而颜色有 6 个，槽位 1 与 5、2 与 6 这样的配对只在颜色通道上
   不同——`6 > 4` 的算术结果，不是算法缺陷，不能宣称"不存在只靠颜色区分的配对"。
3. **label 恒在完整 label keyset 上算**，visual keyset 只决定槽位。所以图例里的 `codex` 与
   列表里的 `codex` 始终同名。
4. **呈现给可渲染值**：`strokeDasharray`、`marker.path`、`fill`（含 `url(#pattern-id)`）
   都能原样交给 SVG / CSS，pattern definitions 由运行时注入。自定义组件不手写 pattern，
   也不把枚举名翻译成 SVG——否则"声明了 series 却没实现 variant"会让 7–12 号身份看起来和
   1–6 号一模一样。

两条推论一并定死：**text renderer 的 `ctx.dimension()` 恒返回 label 面**（④B 的直接推论，
text 面不上 ANSI 色）；**自有 React 页面的 `presentDimension(declaration)` 收同一形状的声明**。

### Q6 线性探测让"上周 vs 本周"重排颜色

分配规则是"稳定散列为起点，撞槽时按显示键字典序线性探测"。加一个新 agent → keyset 变 →
探测序列变 → 已有 agent 的槽位可能整体重排。而报告最高频的读法就是跟上次比。

**A（已定稿）** 双 keyset 让抖动变少——新增 label-only 的表格行不再影响视觉分配——但没有消除它：
visual keyset 的成员一变，未钉住的槽位仍可能重排。

**照实承认约束**：槽位有限时，无法同时保证"集合内两两不撞"和"集合变化后已有值绝对不动"。
契约选前者：

- 默认分配只承诺**同一页内**一致。
- 跨周、跨页稳定必须写 `dimensionPins`。
- pin 钉住的是完整 `seriesSlot`（1..24），不再只钉颜色。
- pin 不能突破 24 容量，也不解决超容量。

---

## 四、Issue 与 Notice 三层化

### Q9 "给不出下一步的报错是缺陷"被删了，替代物是什么？（待答）

旧契约把三段式（现象 / 依据 / 下一步）写进同一个 `message`，承诺"只打印 message 的消费方不
丢失下一步"。新契约改成"在**每个** Notice policy 中登记"，并"未知 code 必须有保守 fallback"。

已认成立的三点：这不是有意降级而是设计缺口；`unknown code → raw detail` 不能作为用户可见
Notice 的正常终点；"每个 policy 各登记一套"会制造 N×M 分叉——而这正是 `components/README.md`
用来否决两层数据方案的同一条理由（"官方口径会分叉"）。

提出的方向是中央 `NoticeCatalog` 拥有语义、默认文案与默认下一步，host policy 只决定可见性、
分组与 action 投影，内建 code 缺项让 typecheck 或 vitest 失败。**但两条追问没答：**

- `defaultAction` 若是 host-neutral，它装的到底是什么？是 shell 命令就等于 CLI 单源，其它宿主
  都在做降级翻译；是抽象动作就要为每个 code × 每个 host 写适配器——N×M 改名叫 `ActionAdapter`
  原地复活。
- 结构化面被这次改动删掉的 `command?: string` 要不要恢复。

### Q10 库消费者的 `err.message` 退化（待答）

`catch (e) { console.error(e.message) }` 是 NiceEval 作为 library 的主要用法。新文写"CLI 不从
`Error.message` 解析修复命令"，但这不等于 `message` 可以没有下一步。

提出的 `NiceEvalError { message, code, context, action }` 方向成立，**但引入了它自己刚判死刑的
形状**：同一个 code 的"下一步"有两个产地——抛出点烤死的英文 `message`，和 catalog 里的本地化
条目，两者迟早不一致。要么 `message` 由 catalog 在构造时生成（catalog 必须能在库层无宿主地跑出
默认 locale 文案），要么明写这里允许两份。

---

## 五、Record 变更（越界，待裁决）

`bcb82b60` 把 Reports 作者面重设计与一组互不相干的 Record 破坏性变更打成一个 commit，
message 是 `update`——违反 CLAUDE.md"不写 update 这类空消息"，而 main 直推下 commit message
是唯一审计线索。

至少九个互不依赖的决定：① Source / Component / Composition 作者模型；② Diagnostic / Issue /
Notice 分层；③ CSS 公共前缀 `nre-*` → `niceeval-*`；④ Measure 名称与聚合 API；
⑤ `retryAttempts` 持久化形状；⑥ `schemaVersion` 11；⑦ `runId` 权威身份；⑧ 目录 percent-encoding；
⑨ locator 长度与派生语义。其中只有 ①②③ 有 memory 裁决条目。

### 现存硬矛盾（本批已修，与位宽裁决无关）

`architecture.md` 与 `library.md` 曾各写一份 locator 格式，两份互斥，实现 Agent 读到哪页就实现
哪套。修它不需要先裁决位宽：**格式与派生元组单点声明在 `architecture.md`，`library.md` 只讲
`resolveLocator` 怎么用，不复述形态。** 位宽本身仍然待裁决，但无论裁成什么，都只改一处。

### 待裁决

1. **位宽。** 36 bit 在 10⁵ 个 locator 下碰撞概率约 7%（10³ 下约百万分之七），确实不够——
   但直接跳到 100 bit 没给出与手输成本相称的模型。locator 是用户手打、粘 URL、肉眼比对的东西，
   从 8 字符变 21 字符。60 bit（12 位 Crockford base32，10⁵ 下约 4.3×10⁻⁹，连 `@` 与 scheme
   共 14 字符）是更可能正确的量级。
2. **碰撞契约完全缺失。** `docs/feature/record/` 里"碰撞 / collision"零命中。而这是 derived id
   不是随机 id——**撞了不能重试**，输入是身份元组，算出来就是那个值。位宽争论在这三问答完之前
   是空转：`resolveLocator` 撞到两条是抛歧义、返回第一条、还是静默返回错的 attempt？写入期检
   不检查？唯一性作用域是一个记录根、一个 Run，还是一次 `show` 的可见范围（位宽算式全靠这个 n）？
3. **`runId` 换掉的是身份语义不只是哈希输入。** 收益是目录移动 / 改名 / 同毫秒不再改变 Run 身份；
   代价是不再能从人可见身份重建 locator，缺 `run.json` 时无法独立恢复。契约要写成"同一个已持久化
   Run 内稳定、跨目录移动稳定"，不能暗示它可从业务身份推导。
4. **`schemaVersion` 11 / percent-encoding / retryAttempts 各自的依据**目前没有任何记录。

### 落地方式

拆 commit 不可行也无用：`bcb82b60` 已在 main，直推仓库，改写历史恢复不了从未写下的理由。
按仓库自己的体裁路由，欠的是 ④–⑨ 六条 `memory/` 裁决条目 + INDEX 行。若裁决为回退 Record 变更，
按"不写差分句"的规矩要**重写** `architecture.md` 相应小节，撤回理由只进 memory。

---

## 六、本批 docs 变更（已执行）

只动批次 1 与 2 的已定稿项。Issue / Notice 与 Record 正文按兵不动，唯一例外是 locator
单源化——那一处不修就是两份互斥契约同时生效。

| 文件 | 改了什么 |
|---|---|
| `design/report-authoring/DECISION.md` | 结论改三概念；`Composition` 从"装配宏"升为运行期编排概念，并给出为什么它是概念而不是装饰能力；呈现改 `ctx.dimension(handle)` 与 24 身份容量 |
| `design/report-authoring/PLAN-2.md` | 收敛注记跟着改口 |
| `feature/reports/architecture.md` | 核心模型三概念；`CompositionContext` 与 `MaybePromise` 签名；resolve 格位；Promise 级 page 缓存；H2 单重载与理由；H4 装载期拦截；`ctx.sample` → `ctx.input`；页级分配改 `seriesSlot` |
| `feature/reports/components/README.md` | 开篇三概念；角色表补 Composition；判据重写成四问加"命中两问必须拆开"；删 `Cell`"全部接口"句改成「全局协议只有 Content」；`dimensions` 必填；两个 keyset、24 身份容量、分配序列、上界照实写、两面差别 |
| `feature/reports/components/primitives/table.md` | 接收单元格类型联合与三条不变量 |
| `feature/reports/components/primitives/stat-grid.md`、`charts/README.md` | 锚点改指 table.md；系列色改口成视觉编码 |
| `feature/reports/components/sources/README.md` | 修跑不起来的示例（进 Composition + `ctx.resolve`），并写明报告文件顶层不取数 |
| `feature/reports/library.md`、`library/layout.md` | 三概念；`DimensionDeclaration` / `DimensionPresentation` 判别联合 / `RenderContext` 全套类型；Heatmap 示例改 handle/index；Composition 小节给签名与缓存 |
| `feature/reports/library/shell.md`、`library/theme.md` | `dimensionPins` 从色槽 `[0,6)` 改成 `seriesSlot` `[1,24]`，并写明 pin 不增加容量 |
| `feature/reports/use-case/**` | 取色、验收、主题三篇跟着改 handle/index，验收清单加"两面都要跑" |
| `feature/record/library.md` | locator 形态与派生元组不再复述，单源到 `architecture.md` |
| `engineering/testing/unit/reports.md` | 覆盖规范补：双 keyset 区分力场景、24 序列两两不同、超容量拒绝、`dimensions` 必填与查询封闭性、**两面 fixture 必跑**、text 面降级、Composition 展开与 Promise 级缓存（计数 fake Source 断言 1 次）、装载期输入不匹配；清 `DataSource` / `defineRowSource` / `endToEndPassRate` 残留 |
| `source-map.md` | 呈现入口改口 |

## 七、批次 3 / 4 / 5 的裁决

### 批次 3：外部数据走冻结快照（已定稿）

选 B。外部数据在跑报告之前落成 JSON 快照，`--data <file>` 或 `config.reportData` 提供，
Composition 经只读的 `ctx.data` 消费。同时禁掉展开回调里的时钟、随机数与文件系统。

选它不是偏好：它是唯一一个同时答完外部 IO、时钟与随机数三件事的方案，而且不用给
`SitePlan` 字节恒等、`writeSite` 全或无、`show` 不打网络这三条已有承诺开任何例外。
C（允许 IO + 非确定性标记）的代价是承诺分裂成两档，读者得先知道自己看的是哪一档；
A（禁止）等于承认三概念模型接不住第一个真实需求。

代价照实写进正文：多一个准备步骤，快照新鲜度归作者。这与 `--record` 已确立的形状一致——
报告读的始终是冻结数据，不是活服务。

### 批次 4：`NoticeCatalog` 是解释的唯一产地（已定稿）

两个洞都堵上：

- **`message` 与 catalog 两个产地** → `NiceEvalError.message` 由 catalog 在构造时用默认 locale
  渲染，不手写。作者只在 catalog 写一次三段式，库消费者 `console.error(e.message)` 拿到自足消息，
  CLI 走 `code` + `context` 本地化——两条路一个产地。
- **`defaultAction` 是 CLI 单源还是 N×M** → 都不是。action 是结构化闭集
  （`rerun` / `edit` / `external` / `ignorable`），内容在 catalog，宿主只写**每类 action 一个
  投影函数**，N×M 塌成 N+M。新增 kind 回闭集登记，与 `enhance` 能力位同一条纪律。

落盘的 `command?: string` 不恢复——那部分本来就改对了。未知 code 的 fallback 也必须带保守下一步，
「给不出下一步的报错是缺陷」对 fallback 同样成立。

### 批次 5：保留 schemaVersion 11（已定稿，用户裁决）

用户 2026-07-27 选择保留 11，接受已有 `.niceeval`（MemoryBench 6 / coding-agent-skill 8 /
NiceEval-Eval 3 个实验目录）读不出——那些 run 的结论已进 memory，原始目录不再回看，
要看旧结果用 `npx niceeval@<旧版本>`。据此：

- **locator 收到 60 bit**（12 位 Crockford base32，共 14 字符）。旧的 36 bit 在 10⁵ 条下碰撞约 7%
  确实不够，但 100 bit 也没有与手输成本相称的模型——locator 要被手打、粘 URL、肉眼比对。
- **补齐原本零覆盖的碰撞语义**：作用域是一个记录根；locator 是派生值，撞了不能靠重算躲开，
  所以写入侧抛 `LocatorCollisionError` 中止、读取侧抛 `AmbiguousLocatorError` 不返回任意一条。
- **`runId` 契约改口**：写成「同一份已持久化 Run 内稳定、跨目录移动稳定」，明确它不可从业务
  身份重建，不再用「确定性派生」暗示旧性质。
- **四项缺失的裁决记录**补进 `memory/record-identity-change-set.md`。

## 八、收尾

`pnpm test:docs`（`writing-baseline.json` 只许变小）、`docs/README.md` 索引核对。
批次 1、2 定稿后把裁决沉进 `memory/`：修订 `report-tree-opens-dual-face-components`（它写的
"第一层公开模型只有 Source 与 Component"已被推翻），并新增一条记录三概念翻案的理由。
