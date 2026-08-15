# v0.12 Report 产品层复用计划

## 目标与固定边界

本计划只迁移 Report 产品层，不恢复旧 Record、旧 Results 或旧 Analysis。

```text
新 Record
   ↓
新 Analysis
   ↓ ReportSample / ClosedRows / MetricValue / DomainView
v0.12 Report 作者与产品层
   ↓ resolved page 的 text / web 双面 + Host-owned machine result
新 SSG Host
   ├─ show / JSON
   ├─ view：托管同一个 revision + watch + last-good
   └─ static：写出同一个 revision
```

这里的“复用 v0.12”不是兼容旧包，也不是保留两套 API。v0.12 的作者 API、组件、DOM、CSS、格式化和交互被选为当前目标；旧数据访问与旧 View Host 不进入新实现。

计划只允许一个统计实现：Report 的 `aggregate()` 是新 Analysis 的薄 facade（外观接口）。组件只能接收关闭后的 `rows`、`points`、`MetricValue` 与 DomainView，不能重新读取 Record 或另算分母。

## 模型路由与责任

本计划不使用 Grok 4.6。Sol Max 只在**当前计划定稿**时做一次只读挑战；实现开始后不再设置挑战门，不让 worker 等 reviewer。实现以 Terra Max 为纵向 owner，V4 Pro 承担边界冻结后的大块移植，V4 Flash 承担盘点、机械迁移、既有 E2E owner 修正和删除检查。

| TODO | 主执行预设 | 角色与理由 | 可并行边界 |
|---|---|---|---|
| R1 | `gpt-5.6-sol` / max | 只读 `design_grill`，仅挑战本计划；不修改文件，不进入实现阶段。 | 可与 R2 的只读盘点并行；结论由 planner 合并。 |
| R2 | `flash-low-researcher` | 地毯式列出当前 diff、v0.12 来源、consumer 与 owner。 | 只读，不与任何写入冲突。 |
| R3–R4 | `terra-max-worker` | 收口 docs 与公开出口，负责语义裁决而非机械复制。 | R3、R4 修改范围重叠，交给同一 Terra 串行完成。 |
| Q.A/Q.C/Q.D | `terra-max-worker` | 准备 author core、最小 Analysis facade、resolved-page/Host machine 边界；只新增未导出的目标文件。 | 与 Q.B 并行；同一 Terra 纵向拥有三者，避免跨层类型漂移。 |
| Q.B | `pro-max-worker` | 按冻结清单准备 cutover 必需的最小 primitives/cell/text 基础。 | 独占新 `definition/primitives/**` 等未导出路径，不改 exports/Host。 |
| Q.X | `terra-max-worker` | 唯一公共 API cutover/integration owner；删除旧出口、切 package exports、迁移消费者并恢复全绿。 | 必须等待 Q.A–Q.D；不与 B/C 同时写。 |
| B | `terra-max-worker` | 新 Analysis→Report facade，需要守住分母、Evidence、lazy read 与 DomainView。 | 与 C 并行；只改 Analysis facade、Report model/adapter，不改 primitives/assets。 |
| C1–C2 | `pro-max-worker` | 大块恢复 primitives、format、locale、presentation、chart math。 | 与 B、C3 并行；独占 `definition/primitives/**`、`model/**`、`presentation.ts`。 |
| C3 | `flash-max-worker` | 机械恢复 CSS、colors、series encoding、enhance.js，并按固定清单核对。 | 与 B、C1–C2 并行；独占 `assets/**`。 |
| C4 | `terra-max-worker` | 收口 React/text/web face 与 package runtime 的边界。 | 等 C1–C3 停稳后串行集成，避免改同一出口。 |
| D | `pro-max-worker` + `flash-max-worker` | Pro 负责需要语义适配的组件；Flash 按不相交目录迁移机械展示代码。 | `site-components`、`summaries`、`entity-lists`、`attempt-detail`、`experiment-detail` 分目录并行；一个 Terra 只做最终出口接线。 |
| E | `terra-max-worker` | built-in Report 纵向 owner，连接新领域数据与恢复后的产品组件。 | 可与 F1 的 Host shell 并行；不得改 F 的 revision 生命周期。 |
| F | `terra-max-worker` | SSG、Effect v3 Scope、watch、last-good、latest-intent-wins 属于生命周期关键路径。 | F1 可与 E 并行；F2–F7 等 E 输出定型后由同一 Terra 串行收口。 |
| G | `flash-max-worker` | 在既有 E2E owner 中做高吞吐、契约明确的 fixture/断言迁移。 | 按现有测试文件 owner 并行；不得新增 owner 或共享追加文件。 |
| H | `flash-max-worker` → `terra-max-worker` | Flash 按清单删除和 `rg`；Terra 独立核对出口、dead code 与编译结果。 | 删除本身串行；复核只在写入停稳后进行。 |
| I | `terra-max-worker` + `flash-max-worker` | Terra 做 AI 视觉与产品 Journey 判断；Flash 采集多 viewport、DOM、错误和 cleanup 收据。 | 同一 candidate/revision 下按 viewport 与 Journey 并行，不改 NiceEval 源码。 |
| J | `terra-max-worker` | 唯一全仓集成者，汇总 typecheck/lint/build/E2E/下游收据。 | 串行；失败退回对应 owner，不在 J 新造兼容层。 |

执行期如果某个 Terra/Pro/Flash 阻塞，先由该纵向 owner 缩小问题并修复；不临时加入 Grok，也不重新开启设计挑战。不同 worker 只能在表中明确的不相交路径并行。

## 文件裁决

### 从 `v0.12.1` 还原为产品基线

实现时使用 `git show v0.12.1:<path>` 读取源文件，再用显式 patch 写入当前目录。禁止用 checkout、restore、reset 或整提交 cherry-pick 覆盖共享改动。

| v0.12.1 来源 | 当前目标 | 处理方式 |
|---|---|---|
| `src/report/definition/report.ts` | `defineReport()`、Page、Report shell、`ctx.report`、结构化 `head` | 还原公开形状；Sample 类型换成当前 `ReportSample`。 |
| `src/report/definition/tree.ts` | 标准 React JSX、两种 `defineComponent()`、单次 resolve、多 face | 还原核心实现；保留当前 Sample/Analysis capability 边界。 |
| `src/report/definition/primitives.tsx`、`definition/primitives/**` | Table、Bars、Scatter、Stat、Tabs、Diff、Source、Conversation 等中立原语 | 以旧实现为基线移植，不经过当前 generic semantic component 重新解释。 |
| `src/report/definition/{cell,grid-layout,table-text}.ts(x)` | Cell、布局、终端表格语义 | 直接移植后只修类型导入。 |
| `src/report/assets/{colors,series-encoding,styles}.ts(x|css)` | 颜色、纹理、classic DOM/CSS | 直接恢复；CSS selector 仅做新站点 shell 的必要前缀适配。 |
| `src/report/assets/enhance.js` | locale、筛选、排序、dialog、渐进增强 | 恢复旧交互；正文和导航在禁用 JavaScript 时仍完整。 |
| `src/report/model/{format,locale,panel,text-layout}.ts` | 数值格式、双语与文本排版 | 直接恢复产品语义，输入改为当前完整 `MetricValue`。 |
| `src/report/model/chart/{math,plot}.ts` | 图表几何与标签 | 恢复旧算法；不得另留 `host/chart-svg.ts` 的第二套图表。 |
| `src/report/presentation.ts` | 颜色与纹理的稳定维度映射 | 直接移植。 |
| `src/report/theme.ts` | basalt/chalk 与主题 token | 恢复公开 API 与 token；接到当前 SSG asset pipeline。 |
| `src/report/runtime/{resolved-page,text,web}.ts`，以及 `target/page-render.ts` 的纯函数 | 一次 resolve 后的 text/web 投影 | 以旧产品行为为基线，替换旧 Record/Sample 输入；target/route identity 服从当前 SSG，不恢复旧 Node Host。 |
| `src/report/extension/{define,meta,types,assets}.ts` | 第三方双面显示原语及其静态资产 | 采用 v0.12 公开形状，重写为稳定 `Symbol.for` descriptor 并接入当前 SSG asset closure。 |
| `src/report/react/index.tsx` | 普通 React 嵌入面 | 恢复标准 React 组件出口；不再要求 NiceEval JSX runtime。 |

### 复用展示代码，但必须重写取数

下列文件不能原样复制，因为 v0.12 的 `ReportInput`、`AttemptHandle` 与 Results 已被新 Record/Analysis 替代。

| v0.12.1 来源 | 可复用内容 | 必须替换内容 |
|---|---|---|
| `src/report/model/{aggregate,calculation,metrics,types,conversions,dataset}.ts` | API 拼写、row/MetricValue DX、显示数据形状 | 旧 Results 遍历、旧 AttemptHandle、旧 denominator 算法。所有指标委托当前 Analysis。 |
| `src/report/components/**/content.tsx`、`faces.ts`、`index.tsx` | 组件树、文案、DOM、text/web face | 旧 compute 输入与旧 Scope。 |
| `src/report/components/**/compute.ts`、`shared-compute.ts`、`projections.ts` | 期望输出形状与 v0.12 用户结果 | 用当前 `aggregate()`、DomainView 和 PageEvidence 重写。 |
| `src/report/built-in/{standard,failures,result-components,stability}.tsx` | 首页、Attempt/Experiment 信息架构 | 旧 Record/Results 读取；数据来自当前 library-owned details 与新 Analysis。 |
| `src/report/runtime/host.ts`、`runtime/load.ts` | 旧产品行为仅作参照 | 不复制。当前 trusted module loader、SSG builder、watch 与 last-good 是唯一 Host。 |

### 保留当前新实现

- `src/record/**`、`src/sample/**` 与 `src/analysis/**` 的新协议、惰性读取、分母和 Evidence 所有权。
- `src/report/author/identity.ts` 的 route/download 规范化与静态路径冲突检查。
- `src/report/author/manifest.ts` 的候选包作者出口核对；内容改成最终 v0.12 目标出口。
- `src/report/execution/{model,paths,problems,results}.ts` 的 SSG revision、问题面与最终 bytes 合同。
- `src/report/host/{from-record,index,node,node/loader,progress,site-assets,static,theme,view-session}.ts` 的 Record→Sample 接线、模块闭包、static 写出、watch、latest-intent-wins 与 last-good。
- `src/view/{server,site,data,index}.ts` 与 `src/view/app/**` 的 SSG 托管、revision reload 与站点 shell；它们不能另造一套 Report 内容 renderer 或产品 CSS。
- 当前 `src/report/built-in/{attempt-evidence-json,attempt-overview,attempt-trace,execution,file-changes,run-membership-overview,sandbox-history,source}.ts` 的新领域数据来源；它们的 presentation 改用还原后的 v0.12 原语。
- `src/report/library/details.ts` 的 library-owned Attempt/Experiment route 与当前 DomainView 绑定。
- `MetricValue`、ClosedRows 与 DomainView 的定义只保留在 `src/analysis/**`；Report 可以从公开入口 re-export type，但不再由 `src/report/semantic/value.ts` 复制定义。

### 必须保留的重构成果：SSG Host

SSG-first（静态生成优先）是本次重构中应保留的产品改进，不属于要回退的 Report API。恢复 v0.12 作者层与产品层后，仍然只有这一条发布管线：

```text
ReportDefinition + 固定 Sample
              ↓ buildSiteRevision()
ClosedSiteRevision
├─ pages：最终 HTML 与 route/head 摘要
├─ assets：CSS、渐进增强脚本及作者声明的静态资源
├─ downloads
├─ host-data：内建领域 result 或自定义 Report 的稳定 revision manifest
└─ problems
              ├─ static：原样写入目录后结束
              └─ view：原样托管 + watch + last-good
```

以下能力不得在还原 v0.12 产品层时删除或重写成旧 Host：

- `ClosedSiteRevision` 作为一次完整、校验通过的站点发布单位；其中不得残留 Sample、Record reader、Promise、组件函数或 Effect Scope。
- `view` 与 `static` 托管/写出同一个 revision 的相同 route、HTML、CSS、script、asset 与 download bytes。
- watch 只触发候选 revision 重建；成功后原子切换，失败时继续提供 last-good。
- latest-intent-wins、请求级 revision 一致性、静态路径冲突、route/download identity 与资源闭包检查。
- trusted module loader、Record→Sample 装配以及构建失败的结构化 problems。

可以删除的是当前 SSG 前面的 generic semantic renderer、自有 JSX runtime 和仿 classic 产品层；不能因此删除 SSG builder、view session 或 static writer。v0.12 的旧 Node Host、旧 watcher 与旧 static pipeline 也不恢复。

### Machine projection 不属于组件第三面

v0.12 组件只有 text/web 双面；这正是要恢复的作者模型。`show --json` 不增加 machine component face（机器组件面），也不从 React DOM、HTML 或 text 反推 JSON。

- 内建 Report 的领域 JSON 由 Host-owned `ReportExecutionResults`（宿主持有的报告执行结果）生成；producer 只能保存已关闭的 `SampleSnapshot`、`MetricValue`、DomainView、problem 和 Evidence reference。
- 自定义 Report 的通用 JSON 只包含 revision/report/sample identity、page/route/head 摘要、关闭后的 rendered text、download 摘要与 problem table；不序列化作者 React tree，也不承诺 generic semantic node。
- 自定义结构化机器数据通过明确的 download/data artifact 定义交付，不把 JSON 解释权藏进任意显示组件。
- text/web 在同一次 resolved page 上投影；machine result 与它们共享同一次固定 Sample 和 execution identity，但不是从显示树派生。

因此当前 `ReportExecutionResults` 的“Host-owned closed result”边界应保留；当前 `reportExecutionShowDocument()` 中对 `ClosedReportNode` 的 generic tree dump 应删除或缩成上述稳定 manifest。`semantic/closed.ts` 不能以“机器第三面”的理由继续持有完整作者 node algebra。

### 结构化 author script 合同

用户已经裁决恢复 v0.12 的结构化 `head` script 能力；本计划不采用挑战者提出的“默认禁止 executable script”。安全和确定性通过显式合同解决：

- author 只能用结构化 HeadTag 声明 script，不开放 raw HTML；声明顺序、属性和 inline bytes 进入 revision identity。
- 本地脚本、package-owned `enhance.js` 与作者声明的静态 asset 进入同一个 SSG asset closure。
- 外部 `src` 允许存在并在 view/static 中输出相同标签；远端响应不冒充 revision 的自包含 bytes，作者承担网络与供应链责任，API 支持 `integrity`、`crossorigin`、`referrerpolicy` 与 CSP metadata。
- script 可以做统计和渐进增强，但不能成为 Report 数据、正文、导航或 Evidence 的唯一来源；禁用 JS 或外网失败时核心内容仍可读。
- `view` 不额外注入只在本地存在的业务脚本；watch/reload 的 Host 脚本与 author script 分属不同命名空间。

### 实现根节点先删除的当前公共 API

当前 Report API 不是供后续代码逐步兼容的过渡层。它把自有 JSX、generic semantic node 和新造 classic facade 固定在每个调用点，继续保留会让恢复的 v0.12 组件再次被改写成当前模型。

因此实现从一次原子 cutover 开始：可以先并行加入尚未导出的目标文件，但对当前公共 API 的第一次修改必须同时完成删除、切换与 Host 接线。不得只删不补，也不得把仓库长期留在不可编译状态。

- 删除 `src/report/definition.ts`，同一变更加入 `src/report/definition/report.ts`、`definition/tree.ts` 与必要 primitives 入口。
- 删除 `src/report/components.ts`，同一变更让公开 `defineComponent()` 与 component types 来自 `definition/tree.ts`。
- 删除 `src/report/author/element.ts`，React-compatible `ReportElement` 与 component descriptor 只在恢复后的 tree 定义一次。
- 删除 `src/report/jsx-runtime.ts`、`src/report/jsx-dev-runtime.ts`、根 `src/jsx-runtime.ts`、`src/jsx-dev-runtime.ts`。
- 删除 `package.json` 的四个 NiceEval JSX runtime exports；作者统一走标准 `react/jsx-runtime`。
- 重写而非删除 `src/report/{index,runtime}.ts`、`src/report/author/{index,manifest}.ts` 与 `src/report/react/index.ts(x)`，让它们只指向恢复后的 v0.12 公共面。
- 当前 `src/report/classic/**` 可以短暂留作 Host 内部旧消费者，但从 cutover 起不再公开导出，也不允许新代码依赖；C、D 完成后再物理删除。

### 替代完成后物理删除的内部实现

删除动作一律在替代实现通过类型检查后串行执行。删除前用 `rg` 证明没有消费者；不以文件名相似为由提前删。

- `src/report/assets/classic.ts`：由 v0.12 `assets/styles.css`、颜色与纹理模块取代。
- `src/report/classic/**`：由 v0.12 `definition/`、`components/`、`model/` 与 `presentation.ts` 取代。
- `src/report/react/enhance.js`：由恢复的 `src/report/assets/enhance.js` 取代，package asset export 指向唯一产物。
- `src/report/host/chart-svg.ts`：由 v0.12 chart web/text face 取代。
- 当前 `src/report/built-in/classic.ts`：由移植后的 standard Report 与官方组件取代。
- 当前 `src/report/host/execute.ts` 中 generic React/semantic node 解释器、`host/html.ts` 中 generic semantic HTML renderer、`host/presentation.ts` 中重复的组件格式化逻辑：替代后删除这些代码；文件路径可保留为新的薄 Host adapter，不能保留第二套 renderer。
- `src/report/model/{presentation,theme}.ts`：由恢复后的根 `presentation.ts`、`theme.ts` 取代。
- `src/report/semantic/**`：Analysis-owned value type 迁回 `src/analysis/**`，author component、generic element、chart/table node algebra 在 text/web 双面与 Host-owned machine result 接通后全部删除；revision 所需的关闭 result/manifest 校验放在 `execution/**`。

### 明确不恢复

- v0.12 的 Record、Results、AttemptHandle、Scope 读取。
- v0.12 `model/aggregate.ts` 与 `model/metrics.ts` 的统计执行算法。
- v0.12 Node Host、旧 View Server、旧 loader、旧 watcher 与旧 static 发布流程。
- v0.12 的源码 Unit 测试文件。测试重置期只加强当前既有 E2E owner，不恢复旧测试套件。
- `fix-show` PR 中为 generic semantic renderer 新造的第二套 classic facade、JSX runtime 与 CSS 拼装；只提取其中能证明长期用户结果的既有 E2E 命题。

## 树形 TODO

字母只是依赖节点，不是阶段；满足前置条件的节点立即执行。箭头 `⇐` 表示必须等待；标记为“并行”的兄弟节点允许同时执行，但不得修改同一路径。

- [ ] **R. 冻结复用边界与共享现场**（计划定稿根；进入实现前完成）
  - [x] R1. Sol Max 只读 design grill 给出 `CONDITIONAL`；原子 vertical cutover、Host-owned machine result、ResolvedPage Scope 与 script 安全合同均已写入本计划。结论只用于计划定稿，执行期不再等待挑战。
  - [ ] R2. 对当前 dirty worktree 的每个 Report diff 标记 owner 与去向：保留、由 v0.12 替代、或等待其它任务；禁止 reset/restore/stash/clean。
  - [ ] R3. 把 `docs/feature/reports/` 改成唯一目标：标准 React JSX、v0.12 作者 API、结构化 script、v0.12 产品组件、新 Analysis、SSG-first。
  - [ ] R4. 固定公开出口清单与一份近原样 MemoryBench `reports/memory.tsx` 编译样例；明确允许差异只有新 Analysis 字段/投影的必要适配。
  - 验收：设计文档不再同时宣称“自有 JSX runtime”“禁止 script”与“保持 v0.12 DX”；`pnpm lint` 通过。

- [ ] **Q. 原子切换 Report 公共 API** ⇐ R（并行准备，单点 cutover；B、C 的共同根）
  - [ ] **Q.A author core**（与 Q.B/Q.C/Q.D 并行）：在未导出的新路径移植 v0.12 `definition/report.ts` 与 `definition/tree.ts`，恢复 `defineReport()`、Page、`ctx.report`、结构化 HeadTag、标准 React element、Fragment、组合/双面组件和稳定 `Symbol.for` descriptor。
  - [ ] **Q.B minimum primitives**（与 Q.A/Q.C/Q.D 并行）：准备仓库现有作者与 built-in 编译所需的 Fragment/Text/Link/Row/Col/Grid/Table、cell 与 text 基础；不改当前 exports。
  - [ ] **Q.C minimum Analysis facade**（与 Q.A/Q.B/Q.D 并行）：准备 `aggregate(sample, ...)` 与 `MetricValue` adapter，只委托当前 Analysis，不复制旧统计或返回假数据。
  - [ ] **Q.D minimum Host closure**（与 Q.A/Q.B/Q.C 并行）：准备 `resolvePage()` / `ResolvedPage` adapter 和 Host-owned machine result/manifest；ResolvedPage 只在 Sample Scope 内短存，revision 不保存 React component、Sample、reader、Promise 或 callback。
  - [ ] **Q.X atomic cutover** ⇐ Q.A、Q.B、Q.C、Q.D（唯一串行切换点）：删除当前 definition/component/JSX public 面与四个 NiceEval JSX runtime；切换 `author/index.ts`、manifest、根 index/runtime、package exports 与 build entries；迁移全部仓库消费者；默认页和参数化详情页走通新垂直切片，不留 compat alias。
  - 验收：`pnpm typecheck` 与 `pnpm run build:report` 通过；隔离消费项目只配置 `jsx: react-jsx` 即可从安装后的包编译同一 Report；安装后候选的 `show`、`show --json`、`view`、`view --out` 最小 smoke 均成功；文件中无 `@jsxImportSource niceeval/report`。Q 不得把不可构建或 Host 不可运行的中间树交给 B、C。

- [ ] **B. 建立唯一 Analysis→Report facade** ⇐ Q（与 C 并行）
  - [ ] B1. 保留 v0.12 `aggregate(sample, { by, values })` 拼写，委托当前 Analysis aggregate；不复制旧 reducer。
  - [ ] B2. 把 v0.12 GroupFunction 适配成 current Dimension，但 callback 只看冻结 Run context，不取得 reader/AttemptHandle。
  - [ ] B3. 保留 `MetricValue` 名称和 v0.12 format/unit/better DX，同时完整携带 state、samples、total、issues、refs。
  - [ ] B4. 用当前 DomainView 实现 Attempt、Observability、FileChanges、Sources 与 Sandbox 投影；Report 不直接读 attachment。
  - [ ] B5. 成本只在 Analysis 定义一次；provider actual 与 estimate 必须分名并保留 provenance，Report 不以 CSS 或默认值伪造旧截图金额。
  - 验收：同一固定 Sample 的 `aggregate()` 与直接 Analysis query 得到相同 row identity、分母、状态与 Evidence。

- [ ] **C. 恢复中立原语、格式化与视觉资产** ⇐ Q（与 B 并行）
  - [ ] C1. 移植 v0.12 primitives、cell、grid、table text、chart math/plot。
  - [ ] C2. 移植 model format/locale/panel/text-layout 与根 presentation/theme；显示端不再 `String(metric.value)`。
  - [ ] C3. 恢复 styles.css、colors、series encoding 与 enhance.js；保留 horizontal Bars、纹理、legend、tooltip、table/details 与移动端布局。
  - [ ] C4. `react/` 出口恢复标准 React 组件；text face 不依赖 react-dom，web face 可用 react-dom/server。
  - 验收：使用普通 rows/points/value 的中立组件不依赖 Analysis token；禁用 JS 后仍有完整文本、标签、表格和链接。

- [ ] **D. 恢复官方组合组件** ⇐ B、C（内部可按目录并行）
  - [ ] D1. `site-components/`：Hero 使用 report title，PoweredBy、链接与 head 行为与 v0.12 一致。
  - [ ] D2. `summaries/`：六个 KPI、总成本、run range、ExperimentScatter；compute 改走 B 的 facade。
  - [ ] D3. `entity-lists/`：ExperimentTable、AttemptList、FailureList；详情 href 使用当前 library route constructor。
  - [ ] D4. `attempt-detail/` 与 `experiment-detail/`：复用 v0.12 content/faces，输入改为当前关闭 DomainView。
  - [ ] D5. 恢复 Conversation、Diff、Source、Waterfall、CommandEvidence 等领域显示组件，但不恢复旧 Record 读取。
  - 验收：组件输入是普通 closed data；组件源码无法取得 Record reader、path、Scope 或 Effect runtime。

- [ ] **E. 用恢复后的组件重建 built-in Report** ⇐ B、D（与 F 的 machine projection 子项并行）
  - [ ] E1. 以 v0.12 `built-in/standard.tsx` 的信息架构重建默认 overview，不使用 generic Record diagnostic 页替代默认报告。
  - [ ] E2. 当前 library-owned Attempt/Experiment Page 继续由新 Sample 枚举，内容改用 D 的组件。
  - [ ] E3. 当前 execution、trace、source、file changes、sandbox、run membership 数据生产保持不变，只替换 presentation。
  - [ ] E4. `show @locator`、`--execution`、`--timing` 与 `--source` 保留领域 JSON，不退化成 generic tree dump。
  - 验收：Run→Attempt→Evidence 的终端、JSON 与浏览器路径均可复核；missing/partial/unsupported 不被过滤。

- [ ] **F. 接入新 SSG Host** ⇐ Q、C（F2、F3 等 E；与 E 的数据组件工作可并行）
  - [ ] F1. 移植 v0.12 `resolvePage()`：作者 callback 与 component resolve 在 Sample 开放时执行一次。
  - [ ] F2. 从同一个 resolved page 生成 terminal text 与 web HTML；两面不重复取数。
  - [ ] F3. 从同一次 execution 的 Host-owned results 生成领域 JSON，或为自定义 Report 生成稳定 revision manifest；禁止从 React/HTML/text 反推 machine document。
  - [ ] F4. builder 枚举全部 Page instance，生成一个完整 `ClosedSiteRevision`；revision 只保存关闭 result/manifest 与最终 bytes，不保存 React component、Sample、reader、Promise 或 callback。
  - [ ] F5. `static` 只写 revision；`view` 只托管同一 revision，并增加 watch、latest-intent-wins、last-good 和 reload 通知。
  - [ ] F6. script、CSS、asset、download、route 与 HTML bytes 全部进入同一 revision identity；view/static 同 route body 逐字节相同。
  - [ ] F7. 替换 current `host/execute|html|presentation` 的 generic renderer；保留它们必要的 Host/CLI adapter 职责。
  - 验收：一个 Page/component callback 的计数为 1；text、两个 locale、HTTP 与 static 不触发第二次 Analysis。

- [ ] **G. 更新既有 E2E owner** ⇐ Q、B、D、E、F（测试文件之间可并行）
  - [ ] G1. `report-execution.test.ts` 使用近原样 v0.12 MemoryBench fixture，证明标准 React JSX、Hero、六 KPI、Bars、Scatter、Table 与详情 route。
  - [ ] G2. `report.browser.spec.ts` 只锁 role、text、href、原生 details/table/dialog 与用户动作；不锁私有 class、精确像素或数据 ID。
  - [ ] G3. `report-export.test.ts` 锁定 view/static 每个 route、asset 与 download 的 bytes 等价。
  - [ ] G4. `report-show.test.ts` 锁定 human/JSON 的领域语义、完整 MetricValue、全 route 集与 canonical order。
  - [ ] G5. `report-config-reload.test.ts` 锁定 last-good、latest-intent-wins 和请求级 revision 一致性。
  - [ ] G6. 从 v0.12 与 PR 52 只迁移能杀死错误实现的用户命题；不恢复旧 harness、像素快照或实现级 Unit。
  - 验收：每项命题删除后会放走一类明确错误；修改后的 owner 通过单项、默认并行、连续两次和隔离副本接管门。

- [ ] **H. 物理删除重复实现** ⇐ D、E、F、G（串行删除门）
  - [ ] H1. 按“替代完成后物理删除”清单逐项 `rg` 消费者并删除。
  - [ ] H2. 清除 package exports、tsconfig `jsxImportSource`、每文件 pragma 与自有 JSX manifest 条目。
  - [ ] H3. 清除第二套 chart、metric formatter、locale、CSS、component resolver 与 semantic HTML renderer。
  - [ ] H4. `src/report/index.ts` 只导出一套作者 API；Host、Record 与 Analysis capability 不泄漏。
  - 验收：删除任一最终保留模块会导致明确编译/功能失败；被删除模块没有 alias、compat wrapper 或 dead export 残留。

- [ ] **I. MemoryBench 真实消费与视觉验收** ⇐ G、H（浏览器 viewport 可并行）
  - [ ] I1. 构建唯一候选 tarball，安装到 `/home/ctrdh/.herdr/worktrees/MemoryBench/2-0`；不得让相邻源码或 stale `dist/report` 冒充候选。
  - [ ] I2. 当前 `reports/memory.tsx` 与 `/home/ctrdh/Code/NiceEval/MemoryBench/reports/memory.tsx` 保持同一业务组件树；只允许必要的 Analysis API 适配。
  - [ ] I3. 公开 CLI 运行 `show`、`view` 与 static export；不直接读取 `.niceeval/`。
  - [ ] I4. 在 2048×1152、1440×900、768×1024、390×844 核对 Hero、六 KPI、横向 leaderboard、scatter、ExperimentTable、详情页、语言、筛选、排序与展开。
  - [ ] I5. 禁用 JavaScript、断开外网后正文与导航仍可读；启用 JavaScript 后作者 head script 与渐进增强工作。
  - [ ] I6. 保存候选 SHA、命令、URL、viewport、截图路径、page/request error 与 cleanup 收据；AI 手工判断字体、间距、纹理和信息密度，不写像素 diff。
  - 验收：当前页与 v0.12 页使用同一 Report 源码表达同一信息层级；差异只来自新数据事实或明确采用的新 Host 行为。

- [ ] **J. 全仓收口** ⇐ H、I（串行尾）
  - [ ] J1. `pnpm run build:report`。
  - [ ] J2. `pnpm typecheck`。
  - [ ] J3. `pnpm lint`。
  - [ ] J4. 运行 Report focused E2E，再运行 `pnpm e2e --repo report`。
  - [ ] J5. 用 `rg` 核对无旧 Record/AttemptHandle 进入 Report、无自有 JSX runtime、无重复 classic/renderer。
  - [ ] J6. `git diff --check`；分别检查 NiceEval 与 MemoryBench 的 status、候选身份和清理收据。
  - 验收：以上命令全绿，公开候选与视觉收据属于同一 digest；没有遗留 server、临时消费目录或本计划 worker。

## 并行依赖图

```text
R ──┬── Q.A ──┐
    ├── Q.B ──┼── Q.X ──┬── B ──────┐
    ├── Q.C ──┤         └── C ──────┼── D ── E ───────┐
    └── Q.D ──┘              Q.X + C ┴── F1 ──────────┼── F2..7 ── G ── H ── I ── J
                                                       └───────────┘
```

- R 是唯一串行根。
- Q.A–Q.D 只准备未导出的目标实现，可按文件边界并行；Q.X 是唯一、短而原子的公共 API 切换，结束时必须全仓可编译且四个公开入口 smoke 成功。
- B、C 的文件所有权不相交，可以并行。
- D 内部按 `site-components`、`summaries/entity-lists`、`attempt/experiment detail` 分目录并行。
- E 的领域 Page 接线与 F 的 Host shell 可并行，但 F2/F3 必须等 E 提供最终 Page 输出。
- G 只在公开 API 与 revision 形状稳定后修改既有 owner，避免测试追逐中间类型。
- H 必须串行，且只能删除已经被 Q–G 取代的代码。
- I 的多 viewport 浏览器验收可并行；候选 tarball、Record selection 与 Report revision 必须相同。
- J 串行汇总，任何失败返回拥有该路径的上游节点，不在 J 新造兼容层。

## 最终验收矩阵

| 边界 | 必须证明 | 不接受的替代证明 |
|---|---|---|
| 作者 DX | 标准 React JSX、近原样 MemoryBench、v0.12 `defineReport/defineComponent/aggregate` 心智 | 自有 pragma、示例专用 tsconfig、只做类型 cast。 |
| Analysis | 唯一分母、完整 MetricValue、Evidence、DomainView | Report 内 map/reduce 重算或裸 number。 |
| 组件 | v0.12 信息架构、DOM、格式化、纹理和交互 | generic semantic dump 加相似 CSS。 |
| Host | 一次 resolve、一个完整 revision、view/static 同 bytes；machine 是 Host-owned result/manifest | view 请求时重新执行 Analysis、static 另一条 renderer，或从 React/HTML 反推 JSON。 |
| show/JSON | 人读领域报告和机器读领域证据都完整 | 成功退出但只输出 locator/generic tree。 |
| 浏览器 | 桌面/移动端、locale、筛选、展开、详情、无 JS 阅读 | 只断言 HTTP 200 或页面含一个 marker。 |
| 删除 | 不再存在第二套 JSX、classic、chart、formatter、renderer | 留 alias/compat wrapper 等以后再清。 |
| 下游 | 安装后的同一候选在 MemoryBench 公开入口可用 | workspace 源码调用、直接读 `.niceeval/` 或 stale dist。 |
