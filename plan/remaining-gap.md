# 剩余差距 TODO（承接 `docs-feature-code-gap.md`）

`docs-feature-code-gap.md` 的主干分支（Record / Sample / 缓存 / Sandbox 复用 / Eval Source /
show-view 宿主 / Judge / Adapter 改名 / o11y 注入）已落地。本文只列**尚未做完**的部分，基于
2026-07-28 对 `src/report/**`、`src/view/**`、`docs/feature/reports/**` 与
`docs/source-map.md` 的逐项核对。

主体是一件事：**Reports 的取数侧做完了，呈现侧没做。** `defineSource` / `defineComposition` /
`sources.*` 已经把 20 个数据源登记成公开面，但没有任何组件消费 `source` prop，内建 `standard`
一次 `sources.*` 都没引用；通用原语只写了 `Table` 和排版件，另外 8 个（含 `Chart`）不存在，
所以 26 个专用组件仍是唯一实现。

## 标记

- `[S]`：与父节点或列出的依赖串行，前置未完成不能开工。
- `[P]`：依赖满足后可与其它 `[P]` 兄弟并行。
- `[X]`：需要真实外部服务或制品发布，代码完成不等于任务完成。
- 每个叶子任务同时交付：实现、已声明类别内的测试、公开出口同步、`docs/source-map.md` 差异删除。
- 标「**需补覆盖规范**」的叶子，动手前先在 `docs/engineering/testing/unit/reports.md`
  的「覆盖规范」加类别；实现 Agent 只为已声明类别写测试。

## 差异结论

```text
剩余差距
├── 0 工作树未落盘：325 个改动未提交，langgraph tier2/tier3 落后
├── 1 Reports 呈现侧
│   ├── source= 协议未接进管线，组件仍是 makeDataComponent 的 spec/data 双形态
│   ├── 页级维度管线不存在：无 dimensions()、无 ctx.dimension、无 24 槽、无 seriesPins
│   ├── Table 仍是扁平预格式化表：无 Cell、无 subRows、无 placeholder、无 <Column>
│   ├── 8 个通用原语缺失：Callouts / Waterfall / SourceView / Conversation /
│   │   DiffView / CopyBlock / Markdown / Chart
│   ├── 26 个专用组件因此无法退场（Hero / HeroCard / PoweredBy 三个按契约保留）
│   └── 公开面仍有 Scope / Snapshot / Metric / *Data 旧词
├── 2 watch 的项目侧监听仍是目录级，未收窄到 import 闭包
├── 3 E2B 公共 baseline 仍钉在 v0.6.1
└── 4 E2E 未跑真实模型 / Docker / E2B
```

## 树形 TODO

- [ ] 完成剩余差距

  - [ ] `[S]` 0 先把当前工作树落盘，这是一切的前置
    - [ ] 按路径分组提交 325 个改动（`src/`、`docs/`、`docs-site/`、`examples/`、`e2e/` 各一提交）；
      提交前 `git status` 确认没有夹带其它协作者的文件。
    - [ ] 提交后跑 `pnpm tiers:sync`（动之前先读 memory 的 tier-sync 条目），
      同步 `examples/zh/tier2/langgraph` 与 `tier3/langgraph`，再提交。
    - [ ] `pnpm vitest run test/unit/example-tiers.test.ts` 转绿。

  - [ ] `[S: 0]` 1 补齐 Reports 呈现侧

    - [ ] `[S]` 1.1 把 `source=` 协议接进管线
      - 契约：`docs/feature/reports/components/README.md`、`docs/feature/reports/architecture.md`。
      - 落点：`src/report/definition/tree.ts`（resolve 阶段解析 Source）、
        `src/report/source.ts`、`src/report/components/shared.ts`。
      - 组件读 `source` prop；resolve 顺序固定为 Composition 展开 → Source 解析 → 完整树校验，
        同层并行、声明顺序不变。
      - page 级缓存键 = Source 对象身份 + input 对象身份，缓存 Promise；Composition 节点不缓存。
      - `ctx.resolve` 只接受与当前 page input 同型的 Source；外部数据经 `ctx.data` 冻结注入。
      - `makeDataComponent` 的 spec / data 双形态在 1.7 完成后整体删除；本节先让两条路并存。
      - 覆盖规范已声明：「resolve 与组合组件」「定义入口」「外部数据快照与确定性」
        「Composition 的展开与缓存」。

    - [ ] `[S: 1.1]` 1.2 实现页级维度管线
      - 契约：`docs/feature/reports/components/README.md#维度呈现分配单位是页`、
        `docs/feature/reports/library/theme.md#钉色`。
      - 落点：`src/report/definition/tree.ts`、`src/report/presentation.ts`、`src/report/theme.ts`。
      - 现状是 `presentDimension` / `shortestUniqueLabels` 两个孤立 helper，管线一侧空白。
      - `dimensions()` 在 `defineComponent` 上必填，缺了按完整用户反馈拒绝；
        label keyset 与 visual keyset 分开收集。
      - `ctx.dimension(handle).at(index)` 只能查询已声明值，越界或编码不符抛
        `UndeclaredDimensionValueError`，不临时分配。
      - 24 个视觉身份上限、撞槽按显示键字典序线性探测、`theme.seriesPins` 原样占位、text 面降级到 label。
      - 覆盖规范已声明：「页级呈现分配」「`dimensions` 必填与查询封闭性」「text 面的呈现降级」
        「主题钉色」「`seriesPins` 在页级色分配中的作用」「公开呈现 helper」。

    - [ ] `[S: 1.1]` 1.3 把 `Table` 升到目标 `TableContent`
      - 契约：`docs/feature/reports/components/primitives/table.md`。
      - 落点：`src/report/definition/primitives.tsx`、`src/report/definition/table-text.ts`、
        `src/report/assets/{styles.css,enhance.js}`。
      - 当前 `TableProps.rows[].cells` 是 `Record<string, string | null>`，四件目标能力全缺：
        `Cell` 值封装（unit / better / **refs 证据链**）、`subRows` 递归下钻、
        `variant: "placeholder"` 覆盖缺口占位行、`<Column>` 覆盖子节点。
      - 加 `source` 形态：`<Table source={sources.entity.experiments} filter />` 必须能编译并渲染。
      - 排序 / 过滤只作为具名 enhance 渐进增强，不改数据；text 面按显示宽度算列宽的既有语义保持。
      - 覆盖规范已声明：「MeasureCell 与缺数据」「数据源」（占位行数据）「数据源选项归一」（`<Column>`）。
      - **需补覆盖规范**：`Table` 原语对 `subRows` 的逐层渲染与 `placeholder` 行不进聚合，
        两面各一份区分力场景。

    - [ ] `[P: 1.3]` 1.4 让 `Grid` / `Stat` 吃 `Cell` 与 `source`
      - 契约：`docs/feature/reports/components/primitives/stat-grid.md`。
      - 落点：`src/report/definition/primitives.tsx`、`src/report/definition/grid-layout.ts`。
      - 当前 `StatProps.value` 是 `LocalizedText | number | null`，只收预格式化值；
        目标要能直接消费 `Cell`（含 refs 与 better），并支持 `source` 形态。
      - `SampleSummary` 在 1.7 靠这一步退场。

    - [ ] `[P: 1.1 + 1.2]` 1.5 补 7 个缺失的非图表原语
      - 七个各自独立、可并行，每个都要 text + web 双面与 `dimensions()`，且只消费 Content、
        不碰 Record / Sample / 磁盘。

      | 原语 | 契约文件 | 替换掉谁（1.7 执行） |
      |---|---|---|
      | `Callouts` | `primitives/callouts.md` | `ScopeWarnings`、`SnapshotDiagnostics`、`AttemptDiagnostics`、`AttemptError` |
      | `Waterfall` | `primitives/waterfall.md` | `TraceWaterfall`、`AttemptTrace`、`AttemptTimeline` |
      | `SourceView` | `primitives/source-view.md` | `AttemptSource` |
      | `Conversation` | `primitives/conversation.md` | `AttemptConversation` |
      | `DiffView` | `primitives/diff-view.md` | `AttemptDiff` |
      | `CopyBlock` | `primitives/copy-block.md` | `CopyFixPrompt`、`AttemptFixPrompt` |
      | `Markdown` | `library/layout.md#markdown` | 无专用件，纯新增 |

      - `Markdown` 的覆盖规范已声明；**其余 6 个都需补覆盖规范**：各写一条「两面投影 + 未声明维度查询失败」
        的类别，断言面是 Content 与两面输出字符串，不经浏览器。
      - 落点：`src/report/definition/primitives.tsx`（或按体量拆 `src/report/definition/primitives/`），
        样式进 `src/report/assets/styles.css`，交互进 `enhance.js`。

    - [ ] `[S: 1.2 + 1.3]` 1.6 实现 `Chart` 原语
      - 契约：`docs/feature/reports/components/charts/README.md` 与同目录五篇。
      - 落点：新建通用图表件，复用 `src/report/components/metric-views/{chart-math.ts,plot.ts}`
        的纯函数（这两份算法可以整体搬走，不重写）。
      - `x` / `y` props 与 `<Series>` 结构节点选字段、mark 和 series；显示决定不进 Source Content。
      - 吃 `sources.measure.chart(...)` 的 Dataset；折线 / 柱状 / 面积 / 散点 / 混合五种 mark。
      - 系列色由 1.2 的页级分配给出；text 面是字符坐标图。
      - 覆盖规范已声明：「Chart 呈现覆盖」「维度绑定的三件通用能力」「纯函数布局算法」。

    - [ ] `[S: 1.1–1.6]` 1.7 用原语替换专用件
      - `src/report/components/entity-lists/`：`ExperimentList` / `EvalList` / `AttemptList` /
        `FailureList` → `Table source={sources.entity.*}`。整个目录只留 `compute.ts` 里的数据源实现。
      - `src/report/components/metric-views/`：`MetricTable` / `MetricMatrix` / `Scoreboard` /
        `DeltaTable` / `StabilityMatrix` → `Table`；`MetricBars` / `MetricLine` / `MetricScatter` → `Chart`。
      - `src/report/components/attempt-detail/`：11 个叶子 → 对应原语 + `sources.attempt.*`；
        `AttemptDetail` / `AttemptAssessment` 保留为 Composition（它们本来就只装配叶子）。
      - `src/report/components/site-components/`：`SampleNotices` / `RunNotices` → `Callouts`，
        `SampleFixPrompt` → `CopyBlock`，`TraceWaterfall` → `Waterfall`。
        **`Hero` / `HeroCard` / `PoweredBy` 保留**——`components/README.md:91` 明确把站点身份件
        排除在原语总表外，它们渲染品牌不是数据投影，形状本身就是契约。
      - `src/report/components/summaries/`：`SampleSummary` → `Grid` / `Stat` + `sources.sample.snapshot`；
        `SampleOverview` 保留为 Composition，内部改用原语。
      - 删除 `makeDataComponent` 与各目录的 `faces.ts` / `validate*` 分叉；
        官方组件不再保留专用 `*Data` renderer。
      - 内建 `standard` 的 show / view 两面只共享 resolved tree 与 Content。
      - 覆盖规范已声明：「站点组件与内建报告」。

    - [x] `[S: 1.7]` 1.8 清公开面旧词与出口
      - 专用件物理删除；公开面只留 Sample* / Hero* / FailureList / Attempt* / 原语 / sources。
      - `*Data` 计算函数不再从 `niceeval/report` 导出（show 改从 compute 内部模块取）。
      - **保留** `resolveMetricLabel`、错误分类的 `FailureScope`（非报告旧词）。
      - 内部类型名 / validator 名可继续带旧词，不影响公开 API。

  - [x] `[P: 无主干依赖]` 2 把 watch 收窄到 import 闭包
    - 现状：view 已能监听记录根与项目根并重建，但项目侧仍是目录级监听。
    - 目标：只跟踪报告文件、主题文件及它们的项目内静态 import 闭包与项目配置；
      忽略范围外记录、依赖目录和临时文件。
    - 落点：`src/view/server.ts`；覆盖规范已声明「持续重建（view 本地模式）」。

  - [ ] `[P][X: 无主干依赖]` 3 发布并切换 E2B 公共 baseline
    - 用当前 Agent 版本与 recipe revision 生成目标 tag，真实构建 Claude Code、Codex、Bub 三份模板。
    - 以运行用户验证 Agent CLI、Node/npm global prefix、PATH、写权限与一条实际 eval。
    - **发布成功后才**更新 `sandbox/e2b/published.json` 与 `PUBLISHED_E2B_BASELINE_TAG`；
      不能先让常量指向不存在的制品。
    - 从公共 ref 新建沙箱做一次冷启动验收。不涉及 npm publish。

  - [ ] `[S: 1 + 2]` 4 跑真实 E2E
    - `pnpm e2e --repo cli`、`pnpm e2e --repo report`（Reports 改动的主验收面）。
    - `pnpm e2e --group sandbox` 与受影响 Adapter 仓库。
    - 外部基础设施失败按 E2E 协议标为 75，不能当产品通过；未跑的仓库要在交付记录里点名。

  - [ ] `[S: 全部]` 5 收口
    - 删 `docs/source-map.md` 已完成的差异行，补真实源码落点；Feature 正文不写实现状态。
    - `pnpm docs:reference`，同步 docs-site 中文任务路径与 examples。
    - 删只服务旧公共模型的 dead code、locale key 与 fixture。

## 并行与串行关系

```text
0 落盘 ──> 1.1 source 协议 ──┬──> 1.2 维度管线 ──┬──> 1.6 Chart ──┐
                             ├──> 1.3 Table ────┴───────────────┤
                             │        └──> 1.4 Grid/Stat ───────┤
                             └──> 1.5 七个原语（内部七路并行）───┴──> 1.7 替换 ──> 1.8 清旧词

独立并行：2 watch | 3 E2B 发布
最终串行：4 E2E ──> 5 收口
```

1.5 的七个原语彼此不共享文件以外的状态，是这批工作里唯一能真正吃满并行的地方；
1.7 会同时动 `src/report/index.ts` 与四个组件目录，必须单人串行完成。

## 验收

### 每个叶子任务

- 测试只写对应 Feature 测试文档「覆盖规范」已声明的类别；标了「需补覆盖规范」的先补声明。
- `pnpm run typecheck`；改 `src/report/**` 后**先跑 `pnpm run build:report` 再 typecheck**，
  否则报错会从无关文件冒出来（memory `streamevent-new-member-cascade`）。
  link 到消费项目验证时同样要先 `build:report`，CLI 读的是预编译 `dist/report/**`
  （memory `linked-consumer-stale-dist-report`）。
- 运行受影响的 Vitest 文件，再 `pnpm test`。
- 每个自定义组件 fixture 必须同时执行 text 与 web 两个 renderer。

### 合流验收

| 合流面 | 必须证明 | 命令 |
|---|---|---|
| 1.1–1.6 原语与管线 | `source=` 与 `data=` 严格等价、页级色分配封闭、两面同口径 | `pnpm run build:report`；`pnpm test` |
| 1.7 替换 | 内建 `standard` 渲染出的 Content 与替换前逐项同值；只剩三个站点身份件是专用的 | `pnpm run view:build`；`pnpm e2e --repo report` |
| 1.8 清旧词 | 旧公共名 `rg` 零命中，docs-site 手写参考页已同步 | `pnpm test:docs-site` |
| 2 watch | 改报告文件触发重建、改依赖目录不触发 | `pnpm test` |
| 3 E2B | 三份 tag 真实存在并冷启动成功 | 从每个发布 ref 新建 E2B 沙箱实跑 |

### 完成定义

- `pnpm run typecheck`、`pnpm test`、`pnpm test:docs`、`pnpm test:docs-site`、`pnpm run prepare` 全绿。
- `src/report/components/` 下不再有 `makeDataComponent`、`faces.ts` 与专用 `*Data` renderer；
  该目录只剩数据源实现与三个站点身份件。
- `docs/source-map.md` 的「与目标契约的已知实现差异」清空。
