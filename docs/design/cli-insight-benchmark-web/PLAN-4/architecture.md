# PLAN-4 —— Architecture

## 唯一语义内核

`AnalysisMaterializer` 是 CLI、Bundle 与 Insight 共用的唯一 query 语义内核。它负责：

- descriptor catalog、dependency identity 与冲突检查；
- selection、Population、alignment 与 comparability；
- `SemanticFrame`、`DomainView` 与 blob source 的闭合；
- MetricValue、missing、Evidence、issue 与 provenance codec；
- 一次 materialization 内的 Sample identity 与资源一致性。

CLI、Bundle writer、Insight RPC 与 React adapter 都不能另写聚合、分母、pairing 或 Evidence join。

## Materialization 顺序

```text
BenchmarkBundleModule + canonical parameters + exact selection
  → validate schema and finite resource graph
  → freeze Record selection and open one Sample
  → validate descriptor identity and alignment
  → close every declared resource
  → validate resource schema, dependencies and budgets
  → canonical encode and digest every resource
  → form canonical manifest and BundleIdentity
  → close Sample
  → publish complete Bundle
```

任何阶段失败都不发布 partial Bundle。Materializer 不因预算截断 row、Evidence、issue、domain entry 或 blob bytes。

Parameter 只填 Definition 已声明的 JSON slot。它不能增删 resource、改变 dependency graph、选择另一 descriptor 或触发 callback 分支。

静态多实例输入是调用方提供的有序 canonical JSON array。Materializer 逐实例产出独立 Bundle 与 receipt；不存在 `enumerate(sample)`、BundleSet、dataset 或 latest manifest。

## Canonical bytes

Manifest 与 frame / domain body 使用同一 canonical JSON：

- UTF-8，无 BOM、缩进或尾随换行；
- object key 按 Unicode code point 升序；
- array 保留领域顺序；明确为集合的 descriptor、resource、issue 与 ref 先按各自稳定 identity 排序并去重；
- number 必须 finite，`-0` 规范为 `0`，使用能 round-trip 的最短十进制表示；
- string 使用 JSON 必需的最小 escape；
- `undefined`、`NaN`、Infinity、symbol、function 与额外字段拒绝。

BundleResource ID 是一个或多个 `/` 分隔 segment。每个 segment 匹配 `[a-z][a-z0-9-]{0,63}`，不得是 `.` 或 `..`。ID 全局唯一。

Canonical path 由 Host 形成：frame / domain 为 `resources/<id>.json`，blob 为 `resources/<id>.blob`。Definition 不能声明 path，因而不能制造 collision 或逃出 Bundle root。

## Bundle identity

资源按 ID 升序排列。Manifest 的 `resources` 使用相同顺序。

```text
payload =
  UTF8("niceeval.benchmark-bundle/v1\0")
  || U64BE(manifestWithoutIdentity.byteLength)
  || canonicalJson(manifest without identity)
  || for each resource:
       U64BE(path.byteLength) || UTF8(path)
       || U64BE(resource.byteLength) || resource.bytes

BundleIdentity = "sha256:" + lowercaseHex(SHA256(payload))
```

Manifest 内的每个 resource 还保存自己 exact bytes 的 lowercase SHA-256。BundleIdentity、resource digest、path 与 byteLength 必须同时验证。

`createdAt`、mtime、绝对路径、部署 URL、随机值与 host name 不存在于 canonical Bundle。Parameter、Definition identity、materializer version、catalog identity 与 exact Sample / selection identity 都进入 manifest，因而进入 BundleIdentity。

## v1 资源与 Evidence

一个 frame 或 domain resource 对应一个 JSON 文件。Materializer 不透明分块，也不为超预算 resource 自动分页。

大型材料只有 Definition 显式声明，并能从发布的 closed blob source 取得时，才成为独立 blob。Definition 不能用 host path 或 arbitrary callback 创建 blob。

Evidence 只有两态：

- `included` 指向本 Bundle 内某个 resource 与 anchor；
- `reference-only` 只保留 Analysis Evidence identity。

NiceEval 不生成部署 URL。用户网站可以把 Evidence identity 映射到自己的 route，也可以只显示 reference-only 状态。

## Schema 与 corruption

- 未知 manifest major：整体 `bundle-version-unsupported`；
- 未知 resource schema：先验证 path、length 与 digest，再把该 resource 标为 `resource-schema-unsupported`；
- 已知 resource 依赖 unsupported resource：同步为 `resource-dependency-unsupported`；
- digest mismatch、缺失 bytes、重复 path、path collision 或 canonical JSON 失败：`bundle-corrupt`；
- Definition / catalog identity 冲突：Record I/O 前 `descriptor-identity-conflict`。

Unsupported 不能把 corruption 改判成兼容状态。已知 consumer 不能在依赖资源 unsupported 时继续声称 available。

Bundle 是可重建派生物，不执行原地 migration。升级 NiceEval 或 resource schema 后，从 Record 重新 materialize，并形成新 BundleIdentity。

## v1 budgets

V1 固定以下上限。Host 可以为部署策略设置更低值，不能在同一 materializer version 下提高：

| 项目 | 上限 |
|---|---:|
| BundleResource 数量 | 128 |
| 单一 frame / domain canonical body | 16 MiB |
| 单一 blob | 64 MiB |
| 全 Bundle resource bytes | 256 MiB |
| 单次 materialization wall time | 120 s |
| Materializer 额外工作集 | 512 MiB |

Blob source 可以分 chunk 读取与计算 digest，但返回的 `BenchmarkBundle` 必须持有完整 exact bytes。全部 blob bytes 因此计入总 bytes 与额外工作集；v1 不提供临时文件或 stream-backed Bundle 返回形态。Frame / domain 在编码前也必须完整闭合，才能验证 rows、issues 与 refs。

Wall time 使用 host 的 monotonic clock。起点是进入 `materializeBenchmarkBundle()`、尚未分配 materializer graph 或打开 Record 的时刻；终点是完成 Bundle validation、函数即将返回的时刻。

计时范围包括：

- parameters、catalog 与 resource graph 检查；
- Sample 打开与关闭、全部 Record I/O；
- 闭合、编码、digest、预算检查和返回值组装。

计时不包括调用方预先加载 Definition module，也不包括另一个 static writer 随后的目录写入。

“额外工作集”精确定义为同一进程的 `observedPeakResidentSetSize - entryResidentSetSize`。Baseline 在上述入口时点、第一次 materializer allocation 与 Record I/O 前读取。Observed peak 是从 baseline 开始的全部采样值最大值。

实现至少在以下时点采样 resident set：

- Sample 打开后；
- 每个 resource 闭合和编码后；
- 每个 blob stream chunk 后；
- manifest 形成后；
- 函数返回前。

Materializer 运行期间还要以不大于 10 ms 的 monotonic interval 采样，因而 descriptor 求值中的短期峰值也进入口径。实现不得强制 GC 来改变口径。函数返回前仍被 materializer 持有的 Bundle bytes 计入工作集。若 runtime 不能观察 resident set，Host 必须在 Record I/O 前以 `bundle-memory-observation-unsupported` 失败，不能跳过预算。

预算失败使用稳定 code：

- `bundle-resource-count-exceeded`；
- `bundle-resource-bytes-exceeded`；
- `bundle-blob-bytes-exceeded`；
- `bundle-total-bytes-exceeded`；
- `bundle-time-exceeded`；
- `bundle-memory-exceeded`；
- `bundle-memory-observation-unsupported`。

未来若需要更高预算、分页或 transparent chunking，必须发布新的 materializer policy / resource schema 并重新裁决。

## 静态发布

Static writer 在输出 root 的同一 filesystem 建 sibling staging directory。Bundle 根 manifest 的固定相对路径是 `manifest.json`；resource 使用前文定义的 `resources/<id>.json|blob`。Writer 写完全部 bytes，重新读取并验证 identity 后，再原子 rename 为 `<out>/sha256-<64 lowercase hex>`。

目录 segment 是 BundleIdentity 的 filesystem encoding：只把 `sha256:` 中的冒号替换为连字符；`manifest.json` 与 receipt 仍使用原始 `sha256:<hex>` identity。

目标 identity 已存在时只能完整验证并复用，不能改写、合并或补文件。失败保留旧目录不变，并删除或报告本次 staging。

删除旧 Bundle 与维护用户自己的 current pointer 不属于 NiceEval。

Static build 顺序固定为：

```text
niceeval bundle materialize
  → immutable Bundle directory
  → user Astro / React / other build
  → user deployment
```

公开目录不包含 Record、reader、Sample、Definition module、host path 或 migration capability。

## 动态发布

NiceEval 不发布公共 Bundle HTTP server。用户私有服务器自行选择 route、参数、selection、鉴权与缓存，再调用同一个 `materializeBenchmarkBundle()`。

每次调用关闭完整有限 Definition。另一组参数、locator、Evidence 或 selection 形成另一 Bundle，不能在旧 manifest 下回查 Record 并 lazy refill。

用户交付的 manifest 与 resource URL 都必须锚定 BundleIdentity。`/latest/resource.json`、可变 resource path 或不同 Sample 的逐资源拼接不构成支持面。

旧 Bundle 在在途请求结束前保持可读。缓存 key 使用 BundleIdentity；Record 是否存在于部署 server 由用户决定，但绝不进入浏览器。

## InsightRevision

Insight 可以保持一个开放 Sample 以惰性查看大详情，但必须用内部 `InsightRevision` 固定它。每个私有 RPC 都携带 revision identity。

Watcher 发现 Record 变化时只提示。用户刷新会先完整打开下一 Sample 和 revision，再切换 UI。旧 revision 的晚到响应因 identity 不匹配而丢弃，不能写进新 UI state。

Insight 私有 transport 可以针对 debug 优化，但 frame、domain、MetricValue、missing、Evidence 和 comparability 必须调用 AnalysisMaterializer codec。Insight 不能重算或替换这些字段。

## React / Astro lifecycle

Framework-neutral Bundle reader 接收用户注入的 byte reader。React adapter 只接收 `BundleHandle`。

BundleHandle 不是 serializable data。Astro island 的正确顺序是：

```text
.astro directly imports user's .tsx island wrapper
  → user adds client:* directive
  → browser wrapper receives serializable manifest/location inputs
  → wrapper constructs user-owned byte reader
  → openBenchmarkBundle() verifies bytes and returns BundleHandle
  → BenchmarkBundleProvider exposes one BundleIdentity
```

NiceEval 不发布 `@niceeval/astro` integration，也不决定 `client:load`、`client:visible` 或 server-only render。

## 旧 Report 职责迁移

| 旧责任 | 新 owner |
|---|---|
| Population、Measure、PricingProfile、cost、closed codec、Evidence identity | Analysis。 |
| Machine query、comparison、correction | `niceeval.query/v1`。 |
| Human exact detail 与摘要 | `niceeval show` terminal formatter。 |
| 第一方详情页、router、语言、图表与无障碍 | Insight 私有实现。 |
| 公开 transport、resource bytes、identity、budget、static materialization | BenchmarkBundle。 |
| React revision coherence 与有限 ARIA 状态投影 | 可选 React adapter。 |
| 用户 Page、route、style、chart、asset、script 与 download | 用户网站。 |

以下对象不迁移，直接删除：

- `defineReport`、Page、ReportSample 与双面 `defineComponent`；
- ResolvedPage、ClosedSiteRevision 与 custom renderer / extension；
- theme、head、作者 script / asset 与 Report shell；
- hash router、`view --out` 与三面图表内核。

原 `show --json` 的机器能力进入 query / domain document；renderedText、Page manifest 与 site identity 消失。任意作者 download、CSS 与 script 不转进 Bundle。
