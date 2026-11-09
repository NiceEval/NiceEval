# 自定义 Benchmark 网页接入面

比较外部网站使用闭合数据、组件或两层接口的取舍；尚未选择公开接入面。
候选中的 Analysis、SemanticFrame 等名称只表达待验证方案，不是当前产品 API；当前读面由 [Inspection](../feature/inspection/README.md) 拥有。

## 自定义 Benchmark 网页接入面 {#overview}

用户会在自己的项目中完整编写 benchmark 页面、路由、样式、图表与交互。这里比较 NiceEval 应当把什么作为稳定公共接入面：闭合数据、可 import 组件，还是两层都提供。

本主题与本地 [Insight](../feature/insight/README.md) 分离。Insight 是 NiceEval 固定维护的 debug UI；它的页面、RPC 与 session 不能成为外部网站接口。

### 三个候选

| 候选 | 稳定公共承诺 | 用户主要工作 | 长期成本 |
|---|---|---|---|
| [PLAN-1：data-first](#plan-1) | Framework-neutral closed data API | 自己写全部 UI | 数据 schema / transport ABI。 |
| [PLAN-2：components-first](#plan-2) | 可 import 组件 props 与行为 | 组合和定制组件 | Framework、DOM、CSS 与组件 ABI。 |
| [PLAN-3：layered](#plan-3) | 数据核心 + 可选组件层 | 按项目选择层次 | 同时承担两层 ABI 与一致性。 |

### 当前裁决状态

[Decision](#decision) 明确暂缓选择公开接入面。三个 PLAN 都是完整候选，不是当前 Feature 承诺。静态与动态、server 与 browser、identity、缓存、预算、Astro hydration、React adapter 和公共 HTTP server 都要由候选分别证明，不能写进共同前提。

## 目标 {#goals}

### 目的与范围

本决策比较外部用户怎样把 NiceEval Analysis 结果接进完全自有的网站。用户拥有页面、DOM、路由、样式、图表、交互、鉴权、缓存和部署；候选只比较 NiceEval 应稳定提供哪一层能力。

本决策不改变 Record 或 Analysis 的统计语义，也不把本地 Insight 变成 public host。

### 设计原则

- **G1 — 用户拥有最终网页。** NiceEval 不能要求网站采用第一方 shell、route、theme 或部署平台。
- **G2 — 统计事实不漂移。** Population、Measure、denominator、missing、comparability、issues 与 Evidence 的唯一 owner 仍是 Analysis。
- **G3 — 自定义能力可验证。** 候选必须用非 React 页面、任意图表库和完全自定义 DOM / CSS 证明边界。
- **G4 — 快速接入可验证。** 候选必须展示 React / Astro 项目的最短可维护路径，而不只比较理论自由度。
- **G5 — 静态与动态都要交代。** 每个候选分别说明无 Record 浏览器权限的静态部署，以及带鉴权的动态更新。
- **G6 — 浏览器无 Host capability。** Record reader、Sample、host path、migration 与其它 authority 不能进入浏览器。
- **G7 — Closed value 完整。** Partial、missing、Evidence 与大型材料不能因为 UI 方便而丢失或伪装。
- **G8 — 长期 ABI 成本显式。** Framework、schema、DOM、CSS、SSR / hydration、版本与恢复都进入比较。
- **G9 — 共同材料方案中立。** 不预设 transport、closed data builder、public server、组件 framework 或 static / dynamic 同义。

### 可验证要求

每个 PLAN 都必须逐项兑现或明确失败 [W1–W9](#cases)。最终选型前还要用同一真实 benchmark 做三份最小 dogfood，并保留可复查的代码与构建文件证据。

## 约束 {#limits}

- **L1 — Analysis 已有闭合值。** `SemanticFrame`、`MetricValue` 与 `DomainView` 不含 reader、Scope、callback 或 Record path，但这不自动决定它们是否成为网页公共 wire format。
- **L2 — 非平表材料存在。** Trace、diff、source、artifact 与 Evidence 可能很大，也可能需要按需读取。
- **L3 — Static browser 没有 Record。** 静态部署必须在受信任 build / server 边界完成所需读取；浏览器只能取得关闭后的内容。
- **L4 — Dynamic 页面有自己的权限模型。** 用户 server 可能按 tenant、route 或 request 控制查询，NiceEval 不能默认公开本地 Record。
- **L5 — Framework 生命周期不同。** React component、Astro build、SSR、island hydration 与非 React 图表库不能由一个 framework 的 props 假装等价。
- **L6 — 组件也依赖数据。** Components-first 可以把 transport 保持为私有实现，但必须说明组件如何在 static / dynamic 宿主运行条件下取得一致输入。
- **L7 — 数据 API 也有 UI 成本。** Data-first 不能用“用户自由”掩盖 loading、revision、a11y、i18n 与 Evidence 状态的重复工作。
- **L8 — Layered 承担两层兼容。** 同时发布 data 与 components 会增加版本矩阵和测试义务，不是自动优于单层方案。
- **L9 — NiceEval 处于 beta。** 可以选择理想公共面，但一旦进入 Feature，用户网页保存的数据或 import 的组件就成为真实 ABI。

### 候选清单

- [PLAN-1](#plan-1)：只承诺 framework-neutral closed data API。
- [PLAN-2](#plan-2)：主要承诺可 import component API，数据 transport 保持组件内部。
- [PLAN-3](#plan-3)：稳定 data core 与可选 component layer 同时发布。

## 验收场景 {#cases}

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| W1 | 怎样完全自定义网页 | 一个非 React 页面、自写 DOM / CSS 与任意图表库 | 用户能控制全部标记、样式和交互，同时读取完整 Analysis 语义。 |
| W2 | 怎样最短接入 React / Astro | 一个已有 design system 的 Astro + React 项目 | 最小页面能显示比较、missing、loading、问题与 Evidence，不接管用户 route / theme。 |
| W3 | 怎样做静态部署 | 受信任 build 进程可读 Record，浏览器与部署 host 不可读 | 静态站文件可离线部署，浏览器没有 Record / Host capability；更新与旧静态站身份清楚。 |
| W4 | 怎样做鉴权动态页面 | 用户 server 按 tenant 和 route 控制访问 | 权限在 server 生效；浏览器只取得获准的关闭内容，缓存不会跨 tenant 或 revision 污染。 |
| W5 | 怎样处理更新一致性 | 页面同时请求摘要、比较与一个详情 | 页面不会把不同 Record view 或 revision 的值拼在一起；失败有明确恢复路径。 |
| W6 | 怎样呈现 Evidence 与大型材料 | Partial frame、unknown schema、trace、diff 与大 artifact | 状态不被折成空值；按需策略、budget、unsupported 与 corruption 都可观察。 |
| W7 | 怎样满足产品体验 | 自定义主题、键盘、屏幕阅读器、en / zh-CN 与 SSR | 候选说明哪些由 NiceEval 保证、哪些由用户负责，并提供可验收边界。 |
| W8 | 怎样迁移 framework | 同一网站从 React 迁到 Vue 或 server-rendered HTML | 明确哪些 NiceEval ABI 可复用、哪些代码必须重写，以及迁移是否触碰 Analysis 定义。 |
| W9 | 怎样升级与恢复 | NiceEval、数据 schema 或组件 major 不匹配，另有损坏输入 | 不兼容与 corruption 分开；旧页面、旧数据或旧组件的回退和重新生成路径清楚。 |

## 候选一：Data-first {#plan-1}

### 稳定公共面

NiceEval 发布 framework-neutral 的 closed data definition、生成流程与 reader contract。网页组件、DOM、CSS、router、chart、a11y 与 i18n 全部由用户拥有。

```text
trusted build/server → NiceEval 生成 closed public data
                                      ↓
                   user React/Vue/Astro/chart/HTML
```

候选 API 形状：

```ts
const definition = defineBenchmarkData({
  resources: {
    comparison: frames({ sets, measures, alignment }),
    attempt: domainView({ view: attemptEvidence, locator: parameter("locator") }),
  },
});

const snapshot = await materializeBenchmarkData({ definition, selection, parameters });
```

名字与精确 wire schema 只属于本候选；在本主题定案前不进入 `CONTEXT.md` 或 Feature。

### Static / dynamic

Static build 在受信任进程中生成完整关闭的数据，再交给用户站点 build。Dynamic 由用户 server 完成鉴权、selection 与数据生成，再向 browser 返回 closed data。

本候选倾向让两条路径使用相同版本化数据 schema，但是否采用同一文件 transport、内容身份、分页或公共 server 仍需通过 W3–W6 证明。

### Cases 与代价

- W1、W8 最强：任何 framework 与 DOM 都直接消费数据。
- W2、W7 较弱：每个项目要自己实现 loading、revision、MetricValue 状态、Evidence 交互、a11y 与 i18n。
- W3–W6 要把 schema、identity、corruption、budget 与大型材料变成长期公共协议。
- 用户仍能误用 side-by-side scalar；NiceEval 只能保留 comparability，不能控制用户图表。

### 重新裁决触发器

若真实 React / Astro dogfood 的大部分代码都在重复相同的状态与无障碍适配，data-only 可能没有足够产品 DX。

## 候选二：Components-first {#plan-2}

### 稳定公共面

NiceEval 发布一个主要 framework 的 component library。用户 import 具名组件或 headless primitives，传入 selection / query props 与 render slots；数据取得、revision 与 closed value 适配属于组件 runtime 的私有实现。

```tsx
<BenchmarkProvider source={source} selection={selection}>
  <Comparison
    measures={[passRate, cost]}
    renderRow={(row) => <MyRow row={row} />}
    renderIssue={(issue) => <MyIssue issue={issue} />}
  />
</BenchmarkProvider>
```

组件 props、context、loading / error 状态、SSR 行为、DOM / ARIA contract 与样式 extension points 都是长期 ABI。内部 transport 不作为任意 framework 可依赖的稳定 data API。

### Static / dynamic

Static 通过支持的 framework SSR / build lifecycle 关闭数据与 markup。Dynamic 由 Provider 的 server / client loader 取得数据，并维护 revision coherence。

Astro 项目需要对应 framework integration 与 island / SSR 决策。非支持 framework 不能绕过组件读取内部 transport。

### Cases 与代价

- W2、W5、W7 最强：官方组件统一 loading、missing、Evidence、revision、a11y 与 i18n。
- W1 较弱：Render slots 可以替换局部 DOM，但完全自定义非 React 页面没有稳定 data API。
- W3、W4 需要组件 runtime 同时适应 build、SSR、鉴权与 browser hydration。
- W8 成本最高：迁出主 framework 等于迁出 NiceEval 公共面。
- Props 一旦吸收 route、fetch、cache、theme 与 chart，很容易重新长成旧 Report 平台。

### 重新裁决触发器

若完全自定义 DOM / CSS 或非 React dogfood 必须复制、反射或依赖内部 transport，本候选不能满足用户拥有网页的目标。

## 候选三：Layered data + components {#plan-3}

### 稳定公共面

NiceEval 同时发布 framework-neutral closed data core 与可选 component layer。组件只能消费稳定 data reader / handle，不拥有 selection、统计计算或另一条 transport。

```text
NiceEval data definition/materialization/reader
  ├─ user framework / chart / DOM
  └─ NiceEval optional components
         └─ user page, route, theme and composition
```

候选 API 同时包含 data-first 的 definition / reader，以及 component-first 的 Provider / hooks / primitives。组件接收已经打开的数据 handle；更换 revision 时只能原子切换一个 identity。

### Static / dynamic

Static 与 dynamic 都先满足 data core 的关闭与权限边界，再由用户选择直接渲染数据或使用组件。Framework-specific hydration 留在用户项目；NiceEval 组件不接管 route、build adapter 或部署。

### Cases 与代价

- W1、W2、W8 都有明确路径：需要自由时用 data，需要最短接入时用 components。
- W5、W7 的通用状态可以由组件复用，同时不阻止非组件消费者。
- NiceEval 必须同时版本化 data schema、reader、component props、DOM / ARIA 与两层兼容矩阵。
- 组件若开始 fetch、选择或聚合，就会形成第二套 owner；机械边界需要长期 lint、测试与 review。
- 组件能力不足时，用户可能仍同时写两份呈现逻辑，layered 并不会自动降低总成本。

### 重新裁决触发器

若 dogfood 证明 component layer 只是极薄包装或长期落后于 data 能力，应退回 data-first。若绝大多数用户只使用组件且 data ABI 无独立消费者，应重新比较 components-first。

## 选型证据门 {#decision}

### 定案

暂缓选择外部 benchmark 网页的公开接入面。

[PLAN-1 data-first](#plan-1)、[PLAN-2 components-first](#plan-2) 与 [PLAN-3 layered](#plan-3) 都不是当前产品承诺。NiceEval 当前只定稿 CLI 与本地 [Insight](../feature/insight/README.md)；Insight transport、machine query 和旧 Report runtime 都不能被外部网页当作临时 API。

这是一个明确的产品裁决。在下列证据门完成前，不发布 `niceeval/benchmark/**`、公共 Benchmark data schema、公共网页组件、Astro integration、公共 Bundle / snapshot transport 或 NiceEval-hosted web query server。

### 依据

三个候选真正拉开差距的不是调用行数，而是 NiceEval 要长期稳定哪一种 ABI：

- Data-first 稳定 schema、identity、reader、budget 与恢复语义，换取 framework 和样式自由。
- Components-first 稳定 props、DOM、ARIA、SSR / hydration 与样式 extension，换取较短接入路径。
- Layered 同时承担两层兼容，并要机械证明组件没有偷偷成为第二个数据 owner。

当前材料没有真实外部网站的代码、浏览器资源体积、DOM / CSS 控制度、a11y、SSR、升级或恢复证据。直接选择 layered 只是在证据不足时把两份成本都接受，不能视为稳妥默认。

### 证据门

最终选型前，使用同一个真实 benchmark 分别完成三个最小 dogfood，并保留可复查代码与构建文件：

1. 完全自定义的非 React 页面，使用任意图表库与自有 DOM / CSS。
2. Astro 静态页面，证明 build、Evidence detail 与无 Record 浏览器边界。
3. React 动态页面，证明用户 server 鉴权、更新、缓存与 revision coherence。
4. 每个候选都包含 partial、missing、unsupported、大型材料、a11y、en / zh-CN、SSR / hydration 与损坏输入。
5. 对比作者代码、依赖与浏览器体积、DOM / CSS 控制度、框架迁移、版本升级、恢复路径和 NiceEval 测试矩阵。

证据必须足以逐项验收 [W1–W9](#cases)。只做漂亮 demo、只测一个 framework 或复用 Insight 私有接口都不能通过。

### 候选状态

| 候选 | 当前状态 | 缺少的决定性证据 |
|---|---|---|
| [PLAN-1](#plan-1) | 保留 | React / Astro 是否重复大量 revision、Evidence 与 a11y glue。 |
| [PLAN-2](#plan-2) | 保留 | 完全自定义与非主 framework 是否仍能满足产品目标。 |
| [PLAN-3](#plan-3) | 保留 | 两层 ABI 的实际收益是否大于维护与兼容成本。 |

### 遗留风险

- 暂缓意味着 NiceEval 暂时没有承诺用户网站作者面；公开文档必须明确这一点。
- 外部项目可能尝试调用 Insight RPC 或 machine query 作为网页 backend；这些接口的 trust 与生命周期不适合作为隐式支持面。
- dogfood 可能暴露第四个候选，例如 server SDK 而不是 data snapshot 或 component library。出现结构性新候选时新增 PLAN，不把它并入现有三案。
