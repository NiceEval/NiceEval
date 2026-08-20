# TanStack Table / Charts 的 Record → Report 适格性审查

> 观察日期：2026-08-14
>
> 研究判断：不适格；建议移到 renderer / chart-kernel 研究方向

[返回产品总览](README.md)。

## 证据版本点

本次核对只使用官方源码、官方文档、package changelog 与正式 migration 文档。

| 产品 | 核对版本 | 固定源码 | commit 日期 | 版本证据 |
|---|---|---|---|---|
| TanStack Table | `@tanstack/table-core` 9.1.2 | [`d003d72879a49e3713cf22bcaa10d8784c1d5afe`](https://github.com/TanStack/table/commit/d003d72879a49e3713cf22bcaa10d8784c1d5afe) | 2026-08-13 | [`package.json`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/package.json)、[`CHANGELOG.md`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/CHANGELOG.md) |
| TanStack Charts | `@tanstack/charts` 0.12.0 | [`db68561e55d608cd9101843615d55757a3c4adbc`](https://github.com/TanStack/charts/commit/db68561e55d608cd9101843615d55757a3c4adbc) | 2026-08-12 | [`package.json`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/package.json)、[`README.md`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/README.md) |

Charts 官方 README 与 [`docs/overview.md`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/docs/overview.md)
都把 0.12.0 标为 pre-alpha，并说明 API 可在 release 间变化。

## 适格性判断

TanStack Table 和 TanStack Charts 都不具备 Record → Report 产品闭环。

| 适格条件 | TanStack Table | TanStack Charts | 判定 |
|---|---|---|---|
| 发起并执行一次实验 | 只创建 table instance 并派生当前 row model | 只把 definition 编译成 scene 并渲染 | 均无 |
| 保存运行结果 | 只维护内存 state 与 cache；持久化由应用负责 | runtime 不缓存应用数据；持久化由应用负责 | 均无 |
| 重新打开历史结果 | 应用重新提供 data 与可选 state | 应用重新提供 definition 与 data | 均无 |
| query / align / compare 历史运行 | 只处理当前输入 rows | 只编码当前输入 data | 均无 |
| migration 已保存结果 | v8 → v9 文档迁移调用 API | migration 文档迁移图表实现 | 均不迁移用户数据 |

两者没有 Experiment、Run、Trace、Evaluation 或等价资源。
也没有产品拥有的数据库、结果目录、历史 API、持久 schema version、兼容 reader 或升级命令。

这不是“闭源实现未公开”的推断。
两个项目都公开了相关 runtime；Charts 官方文档还明确把 persistence 交给 application。

## 没有实验执行；只有应用内计算

### Table 的真实顺序

Table 没有启动实验的 CLI、scheduler、attempt 或完成标识。
最接近“执行”的路径是一轮 instance 建立与 row-model 派生：

1. 应用用 `tableFeatures()` 组合 feature、row-model factory 与算法 registry。
2. 应用调用 framework adapter 的 `useTable()`，或直接调用 core 的 `constructTable()`。
3. `constructTable()` 合并 options，取得 feature initial state，并建立 `baseAtoms`、派生 `atoms` 与只读 `store`。
4. feature 安装 table / row / column / cell API；row-model factory 按读取惰性建立。
5. renderer 调用 `getRowModel()`；顺序是 core → filtering → grouping → sorting → expanding → pagination。
6. `manual*` 或缺少 factory 时，该阶段直接返回 `getPre*RowModel()`，处理责任在应用或服务端。
7. UI 事件调用 `setSorting()` 等 feature API，state owner 更新；下一次读取重算失效的派生模型。
8. 组件卸载只结束当前应用实例；Table 没有 durable close 或 completion record。

源码证据：

- `tableFeatures()`：`packages/table-core/src/helpers/tableFeatures.ts`（固定 commit 中）
- [`constructTable()`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/core/table/constructTable.ts)
- [`useTable()`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/react-table/src/useTable.ts)
- [`coreRowModelsFeature.utils.ts`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/core/row-models/coreRowModelsFeature.utils.ts)
- 官方 [Row Models Guide](https://tanstack.com/table/latest/docs/guide/row-models)

### Charts 的真实顺序

Charts 也没有实验 CLI、scheduler 或 durable completion。
DOM host 的真实顺序是：

1. 应用准备 data，并用 mark factory 与 `defineChart()` 建立 definition。
2. 应用调用 `mountChart(container, options)`；它建立 renderer 与 runtime host。
3. host 根据显式 size、容器测量或 `initialWidth` 确定当前 surface size。
4. `ChartRuntime.render()` 展开 responsive definition，再调用 `createChartScene()`。
5. compiler 初始化 marks，materialize channels，计算 scales、guide / legend layout、nodes、points 与 controls。
6. compiler 返回完整 `ChartScene`；renderer 投影到 surface，再调用可选 `onRender`。
7. resize、font load 或 `host.update()` 会重新编译并渲染。
8. `host.destroy()` 清 observer、listener、scheduled frame、tooltip、surface 与 markup。

`onRender` 只表示当前 surface render 完成，`getScene()` 只返回当前 scene。
它们都不是历史运行的完成标识。

源码证据：

- [`defineChart()` / `createChartScene()`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/src/scene.ts)
- [`createChartRuntime()`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/src/runtime.ts)
- [`mountChart()`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/src/dom.ts)
- [`mountChartRenderer()`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/src/renderer.ts)
- 官方 [Quick Start](https://tanstack.com/charts/latest/docs/quick-start)
- 官方 [Runtime and Scene](https://tanstack.com/charts/latest/docs/reference/runtime-and-scene)

静态路径是 definition + size → `createChartScene()` → `ChartScene` → `renderChartSvg()` → SVG string。
它是一段同步计算与投影，也不创建运行事实。

## 没有 durable storage；只有瞬态结构与显式导出

### Table 的输入、state、cache 与 index

| 对象 | 精确 type / symbol | 分类 | owner |
|---|---|---|---|
| source rows | `TableOptions.data: ReadonlyArray<TData>` | 应用权威输入 | application |
| columns | `ColumnDef[]` | 应用声明的视图语义 | application |
| current state | `TableState<TFeatures>` | 当前交互状态 | internal atom 或 application |
| initial state | `Partial<TableState<TFeatures>>` | instance 起点与 reset 初始值 | application 输入，Table clone |
| current store | `ReadonlyStore<TableState<TFeatures>>` | state slices 的派生快照 | Table |
| row model | `rows`、`flatRows`、`rowsById` | 派生模型；`rowsById` 是当前 index | Table cache |
| `_rowModels` | `CachedRowModels` | memoized getter cache | Table instance |

公开结构在 [`TableState`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/types/TableState.ts)、
[`Table`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/types/Table.ts)、
[`RowModel`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/core/row-models/coreRowModelsFeature.types.ts)
和 [`CachedRowModels`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/types/RowModel.ts)。

package 没有数据库 table、ORM model、对象存储 key、结果目录、持久 envelope、`schemaVersion`、reader 或 writer。

实验性 worker 的 `TableWorkerRequest`、`TableWorkerResult` 与 `TableWorkerStagePayload` 是唯一具名序列化 envelope。
它们带 `requestId`、`dataVersion`、state、`Uint32Array` permutation 或 group tree，只用于 `postMessage` round trip。

[`tableWorkerProtocol.ts`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/worker/tableWorkerProtocol.ts)
没有磁盘 version、文件名、reader 或跨会话恢复语义。

### Charts 的 definition、scene、cache 与 index

| 对象 | 精确 type / symbol | 分类 | owner |
|---|---|---|---|
| source data | mark 直接引用的任意 application values | 应用权威输入 | application |
| definition | `StaticChartDefinition | ResponsiveChartDefinition` | 可执行声明 | application |
| scene | `ChartScene` | 当前 render 的完整派生值 | scene compiler |
| interaction point | `ChartPoint` | source datum + semantic value + pixel anchor | scene compiler |
| nodes | `readonly SceneNode[]` | renderer-neutral display tree | scene compiler |
| `spatialIndex` | `ChartSpatialIndex` | 当前 points 的可选查找 index | definition factory + host |
| host `scene` / focus / tooltip | current values | transient cache / state | mounted host |

公开形状在 [`types.ts` 的 `ChartDefinition`、`ChartPoint`、`ChartScene` 与 `ChartRuntime`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/src/types.ts)。

responsive definition、channels、scales 与 extensions 可含函数。
官方类型没有承诺 JSON serialization，也没有 object version、codec 或兼容 reader。

官方 [`Runtime behavior`](https://tanstack.com/charts/latest/docs/reference/runtime-and-scene#createchartruntime) 明确说 runtime 不缓存 application data。
definition memoization 与 async cleanup 由 framework adapter 和应用负责。

### export artifact 的精确边界

| API | 输出 | 默认文件名 | Charts 能否重新打开 |
|---|---|---|---|
| `renderChartSvg(scene, options)` | SVG string | 无 | 否 |
| `serializeChartSvg(target, options)` | SVG string | 无 | 否 |
| `downloadChartSvg(target, filename)` | 浏览器下载 | `chart.svg` | 否 |
| `renderChartImage(target, options)` | `Promise<Blob>` | 无 | 否 |
| `downloadChartImage(target, filename)` | 浏览器下载 | `chart.png` | 否 |

源码是 [`svg.ts`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/src/svg.ts)
和 [`export.ts`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/src/export.ts)。
官方 [Exporting Guide](https://tanstack.com/charts/latest/docs/guides/exporting) 只承诺 scene → SVG、mounted SVG serialization 与 surface rasterization。

SVG / bitmap 是一次视觉投影。
它不保存 source rows、definition function、query、运行身份或 provenance；Charts 也没有 export → `ChartScene` 的 inverse reader。

## 写入 owner、批处理、失败与 resume

### Table

state slice 的读取优先级是 external atom → controlled `state` → internal `baseAtom`。
该优先级由 [`constructTable()`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/core/table/constructTable.ts) 建立。

内部 state 由 feature API 写 `baseAtoms`。
应用提供 writable atom 时，atom 是 owner；应用提供 `state` + `on[State]Change` 时，callback 是 owner。
[`TableOptions.state`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/core/table/coreTablesFeature.types.ts)
的源码注释明确说持久化发生在 Table 外部。

这里的 per-slice atom 与 reactive batch 只描述进程内状态粒度和通知时机。
[`coreTablesFeature.utils.ts`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/core/table/coreTablesFeature.utils.ts)
用 `_reactivity.batch()` 合并通知，但没有 WAL、rollback、crash recovery 或原子文件替换。

普通 row-model pipeline 同步返回或抛普通 JavaScript exception。
公开类型没有 partial result、checkpoint、retry policy 或 resume token。

实验性 worker 有更具体的非 durable 行为：

- `workerRowModels.isPending` 只表示跨线程计算尚未返回。
- 请求 single-flight；in-flight 期间的变化在 trailing edge 合并。
- `dataVersion` 不一致的旧结果会被丢弃并立即重算。
- 计算期间保留上一次 row model。
- worker 失败时保留最后结果、停止更新；未产出结果的阶段回退到 pre-stage model。
- `tableWorker.terminate()` 手动终止；下一次读取惰性重建 worker。

这不是跨进程 resume。
证据见 [`createTableWorker.ts`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/worker/createTableWorker.ts)
和官方 [Worker Row Models Guide](https://tanstack.com/table/latest/docs/guide/worker-row-models)。

### Charts

application 拥有 source data、query、filter、domain state 与 persistence。
compiler 拥有一次同步 derivation，host 拥有当前 surface 与 interaction，浏览器拥有最终 download 目的地。

[`docs/overview.md`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/docs/overview.md)
明确把 persistence 和 application state 交给 application。

`createChartScene()` 返回完整 scene，或在缺 scale、duplicate control id 等 authoring error 上抛 `TypeError`。
它没有 partial scene、checkpoint、commit record、rollback 或 resume。

`renderChartImage()` 在缺 surface、browser document、非零尺寸、Canvas 2D、SVG decode 或 `toBlob()` 失败时 reject / throw。
它不保留 partial bitmap，也没有 retry policy。

`downloadChartSvg()` 构造 `Blob` 后触发浏览器下载。
Charts 不控制浏览器和操作系统的最终文件写入，因此不承诺 atomic replace。

`ChartHost.destroy()` 只释放当前资源，不产生结果完成标识。

## 没有历史 reopen、query、align 或 compare

### Table

| 动作 | 实际能力 | 缺失能力 |
|---|---|---|
| reopen | 应用重新传入 data、columns 与 rehydrated state | 无 run id、record reader 或版本检查 |
| query / filter | filter 当前 data，或 `manualFiltering` 交给服务端 | 不查询 Table 保存的资源 |
| group | 对当前 rows 建 grouped `RowModel` | 不认识 Experiment、Attempt 或 denominator |
| align / compare | 应用可先构造任意 comparison rows | 无跨 Run identity、missing 或 alignment 契约 |
| render | 应用遍历 instance 自建 markup | 无 Report、Dashboard 或静态站入口 |

`rowsById` 是当前 row model index，不是历史数据库。
package 只有 ESM exports，没有产品 CLI `bin`；证据见 [`@tanstack/table-core/package.json`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/package.json)。

### Charts

| 动作 | 实际能力 | 缺失能力 |
|---|---|---|
| reopen | 应用重新建立 definition 并提供 data | 无 record id、reader 或 stored resource |
| query / filter | 应用、SQL 或 data layer 先算 | Charts 不查询历史 store |
| align / group | 应用 transform、TanStack 行转换函数或 D3 准备 rows | 无 Run identity、denominator 或 missing policy |
| compare | 应用把 comparison data 编码为 marks | 无 experiment comparison resource |
| render | SVG、Canvas、custom renderer | 只有当前 chart，不是 Report system |
| reopen export | 普通 viewer 可看 SVG / image | 不能恢复 definition、data 或 scene |

Charts 可以显示调用者提供的 historical data，却不拥有历史资源。
没有 input row 或 channel value 时，mark / application policy 决定空值或缺值表现；产品没有跨 Run missing / partial 语义。

[`@tanstack/charts/package.json`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/package.json)
只发布 ESM subpaths，也没有实验 CLI `bin`。

## version、compatibility 与 migration

### Table 的轨道

9.1.2 是 package version，不是保存对象的 schema version。
[`CHANGELOG.md`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/CHANGELOG.md)
把 9.0.0 标为 v9 stable，并在 9.1.x 变更日志中列出 API / behavior release。

正式 [v8 → v9 React migration guide](https://tanstack.com/table/latest/docs/framework/react/guide/migrating) 修改的是应用源码：

- `useReactTable` 改为 `useTable`。
- 显式提供 `tableFeatures()` 与 row-model slots。
- `table.getState()` 攅读 `table.store.state` 或 `table.state`。
- 全局 `onStateChange` 改为 per-slice callback 或 external atoms。
- `sortingFn` 改为 `sortFn`，column pinning 改为 `start` / `end`。
- `columnSizingInfo` 改名为 `columnResizing`。

React adapter 的 deprecated [`/legacy` export](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/react-table/package.json)
让 `useLegacyTable` 暂时接收 v8-style API。
它是 runtime source compatibility，不是旧数据 reader。

Table 没有 migration command，也不读取或改写 localStorage、URL、数据库或用户文件。
应用若持久化 v8 state，必须自行迁移字段与 envelope；TanStack 不会重写 source rows 或保存数据。

### Charts 的轨道

0.12.0 是 pre-alpha package version，不是 `ChartDefinition` 或 `ChartScene` schema version。
scene 和 definition 中都没有 `0.12.0`、object version 或 reader dispatch。

正式 [Migrating Guide](https://tanstack.com/charts/latest/docs/guides/migrating) 迁移的是图表实现：

- 固定旧 chart 的数据变换、scale、交互、可访问性与性能契约。
- 把 layers 翻译成 marks、channels、scales 与 guides。
- 从旧 adapter / scale packages 改用 `@tanstack/charts/*` subpaths。
- 按 breaking API 调整 axis、stack、focus 与 callback context。
- 用 frozen data 与 parity gates 验收，再删除旧 renderer。

同一文档没有数据库 scan、对象升级或用户数据 rewrite。
它建议首次迁移保留 application、server、SQL 或 D3 transforms，进一步确认用户数据仍由原 owner 管理。

0.9.0 changelog 说明旧 package names 暂时保留兼容。
这是 import compatibility，不是历史 scene reader；证据见 [`packages/charts-core/CHANGELOG.md`](https://github.com/TanStack/charts/blob/db68561e55d608cd9101843615d55757a3c4adbc/packages/charts-core/CHANGELOG.md)。

Charts 没有用户数据 upgrade command，也没有 store 可供遍历。
应用自存 definition-like JSON、filter state 或 domain state 时，pre-alpha API churn 仍须由应用迁移。
已下载的 SVG / bitmap 不会被 upgrade 重写，也不会自动获得后续 renderer 行为。

## 读取时计算、显式导出与 schema churn

Table 不跨会话保存可计算值。
row models、facets、accessor values、cells、selection bounds 与 indexes 都是 instance 内 cache 或读取时派生。

一个清楚的边界是 `CellSelectionState`。
它保存语义 anchor / focus ids；drag session 留在非 reactive instance data，bounds 按当前 display order 计算。
源码说该 slice 可由应用安全持久化，但 Table 不提供 store 或 envelope：
[`cellSelectionFeature.types.ts`](https://github.com/TanStack/table/blob/d003d72879a49e3713cf22bcaa10d8784c1d5afe/packages/table-core/src/features/cell-selection/cellSelectionFeature.types.ts)。

Charts 每次 render 重新计算 channels、scales、margins、axes、nodes、points 与当前 spatial index。
唯一由 export API 显式生成的派生值是 SVG / bitmap，因为它是交付格式，不是下次 compilation cache。

这种设计让两个库都没有自己的 durable schema churn。
它没有消除升级成本，而是把持久兼容责任交给应用：Table state slice 改名或 Charts pre-alpha API 变化时，应用自有 JSON、URL 或 DB schema 仍需自行演进。

## 未公开边界

本研究没有依赖闭源服务端。
两个 package 的相关 runtime、types、docs、changelog 与 migration guide 都在官方仓库公开。

浏览器下载采用什么临时文件、rename 或同步策略由浏览器与操作系统决定，不属于 Charts 公开契约，本研究不作推测。

## 移出方向建议

建议保留这份研究，并把目录整体移到 renderer / chart-kernel 方向。
Table 可作为 state → row model → markup 的 headless 样本，Charts 可作为 definition → keyed scene → multi-renderer 的样本。

不建议继续留在 Record → Report 产品索引，也不建议为满足目录模板虚构存储、历史查询或 migration 层。
本次受修改范围限制，不改上级 `record-to-report/README.md`。
