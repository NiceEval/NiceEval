# Report 架构

Report 有单目标终端路径与全站关闭路径。两条路径共享 ReportDefinition、固定 Sample、Analysis 口径和 text/web 组件，
但只由全站路径形成 `ClosedSiteRevision`（闭合站点版本）。

## 两条执行路径

```text
niceeval show
  │ select one exact route
  ▼
open fixed Sample → execute selected Page → private `ResolvedPage` → text / JSON → close Sample

niceeval view / niceeval view --out
  │ open fixed Sample
  ▼
enumerate every Page instance → execute every Page → validate site → ClosedSiteRevision
                                                               │
                                                   ┌───────────┴───────────┐
                                                   ▼                       ▼
                                                 view                    static
```

`show` 只执行目标 Page。省略 `--page` 时使用 Report 的默认 route；带 `--page` 时使用精确 route。它不枚举参数 Page，
不执行其它 Page，也不创建 site revision。

`--experiment <selector>` 与 `niceeval exp <selector>` 使用同一实验选择规则并形成固定 Sample；Report 不增加另一套实验组 CLI selector。浏览器只沿 Report 内容交付的 Page 链接导航，不重新选择 Sample；通用 shell 不识别实验组。

`view` 和 `view --out` 先要求固定 Sample 至少选中一个 logical Slot，再枚举全部普通 Page 与参数 Page 实例。零选中结果是
`report-sample-empty` 输入错误，不形成 revision。只有所有页面、route、链接、下载、asset、问题表和预算通过校验，Host 才形成
一个 revision。view 只托管它；static 只写出它。

`pages` 是唯一的 Page 集合。作者明确声明业务 Page 与 overlay；Host 不由 locator、组件或导航推断并回填详情。所有业务 Page 和 overlay 都在同一个根 document 内由 hash router 呈现。若 Page 请求成本投影，其 Profile、Analysis 闭合与 target / full-site 范围由
[Report 成本投影 Architecture](cost-projections/architecture.md) 定义。

## 参数 Page 的单目标读取

参数 Page 的 show 路径严格按以下顺序工作：

1. 从目标 route 取 key，调用该 Page 的 `params.decode(key)`。
2. 对得到的 params 调用 `params.encode(params)`，结果必须与原 key 完全相同。
3. 调用这个 Page 的 `load(sample, params, ctx)` 与 `render(input, ctx)`。
4. 关闭该页的 text 或机器输出，随后关闭 Sample。

这条路径不调用 `enumerate()`。`PageLoadContext` 与每个公开 DomainView 入口必须验证 params 所指 locator、identity 或 key 属于
当前 Sample；不属于 Sample 的值以类型化错误结束。该成员资格检查不能借由执行其它 Page 获得。

全站路径仍对每个参数 Page 调用一次 `enumerate(sample)`。每个枚举值都要经过 encode、decode、再 encode 的规范检查，
然后成为 revision 中唯一可服务的 route。

## 私有页值与闭合站点版本

作者 callback 返回标准 React element。Host 在 Sample Scope 内完成组件组合、数据读取和两面呈现；私有
`ResolvedPage` 短暂保存已经关闭的 Page 投影。React element 只留在关闭 Page 的短生命周期中；`ResolvedPage` 既不是作者 API，也不进入机器输出或 revision。

公共作者面不定义 `ReportNode`、`ReportElement`、`ClosedReportNode` 或其它通用 semantic tree。Host 也不从 React、HTML 或
terminal text 反推机器数据。

`ClosedSiteRevision` 是 Host API 的不透明闭合值；作者不读取其字段。它至少绑定一个根 `index.html` app shell、每个 hash 目标的 HTML fragment、rendered text、CSS 与唯一 app client。
它还绑定作者 asset、下载文件、`_niceeval/data/projections.json` 与 Host 问题表的 canonical bytes。

revision 不保存 Sample、Record reader、Promise、callback、React element、组件函数、文件 capability 或未解释的 Record payload。
它的 identity 绑定 Sample、Report、renderer、页面、asset、download、`_niceeval/data/projections.json` 与问题表的 canonical bytes。

`show` 的内部单目标页值没有 `ClosedSiteRevision.identity`。自定义 `show --json` 只从这个单目标执行生成
target-execution manifest；它不能借用或伪造 revision identity。

## 字节合同、app client 与脚本

同一 `ClosedSiteRevision` 中，根 app shell、每个已关闭 HTML fragment、CSS、作者 asset、下载文件、`_niceeval/data/projections.json` 与 app client 都有最终 bytes。view 与 static 使用相同的根 shell 和 fragment bytes；没有每 route HTML 或可直接打开的 Page document。HTTP header、连接和刷新通知不改变这些 bytes。

每份 revision 只有一个 app client；路由、语言、Report 组件增强与 live reload 都由它拥有。view 的 app 响应以 header 标记 live revision，client 只有看到该标记才探测刷新端点；静态目录因此不会请求不存在的端点。静态输出只支持普通 HTTP(S) host，不需要 rewrite 或 NiceEval server；`file://` 不属于产品入口，也不为它内联第二份 fragment。

`head` 的结构化 script 与本地 asset 进入同一资源闭包。外部 script 标签的属性进入 HTML bytes；远端响应不冒充站点 bytes。
作者 script 和 app client 使用不同命名空间，不能互相替换或依赖对方取得报告数据。

## CSS、theme 与 View shell

`src/report/assets/styles.css` 是 Report 产品 CSS 的唯一 owner。它拥有 scoped reset、基础排版、表格、图形、overlay、响应式布局和
官方组件 selector。报告组件不各自带一份 reset，也没有第二条 classic 或 generic renderer CSS 管线。

`theme.ts` 只定义 theme token 与 token 值；它不新增 reset、布局 selector 或组件样式。`styles.css` 是 token 的唯一消费者。
作者通过结构化 `head` 提供的样式只能服务自己的具名内容，不能建立另一套 reset、theme 或 View shell。

View shell 只拥有浏览器语言切换、reload 状态、Host 错误提示和通用 Page 导航。品牌位于左侧，完整 Page router 作为一个整体居中，右侧只承载语言选择。实验组选择属于标准 Report 的已闭合内容与链接，不由通用 shell 读取 `role` 或生成 selector。

Shell 不读取 Analysis、不在浏览器计算比较范围、
不注入第二份产品 CSS，也不重绘已关闭的 Report 内容。

所选逻辑 Attempt 没有 Record 输入时，Report 正文以 `not-recorded` notice 与 partial MetricValue 呈现一次。Host 不再把同一事实重复成
`analysis-missing — the selected logical Slot has no input value`；带具体语义的附件缺失、无效输入或迁移提示仍保留在数据说明中。

站点只有一个根 `index.html` app shell 和一个 `_niceeval/manifest.json`。manifest 是客户端 route、`presentation`、title 与 fragment path 的唯一 owner；shell 不再内联第二份 manifest。Hash router 从 manifest 生成真实 route objects，再挂载已关闭 HTML fragments，不重做 Analysis、JSX 或作者 callback。

Attempt、Source 和 Diff 只能以 `overlay` 呈现。overlay 以 `#/<page-route-prefix>/<key>` 表示目标，并在当前业务 Page 上显示；Escape、关闭按钮和浏览器返回会关闭它并恢复前一 hash。禁用 JavaScript 时根 shell 明确报错。

## 全站关闭预算

下列预算作用于一次全站构建。Host 在分配无界集合前检查可知数量，并在收集页面、节点和 bytes 时累计；超过任一上限时，
构建以 `report-build-budget-exceeded` 失败，view 保留 last-good revision。

| 项目 | 最大值 | 计数范围 |
|---|---:|---|
| 页面数 | 20,000 | 全部普通 Page 与参数 Page 实例。 |
| 单页文档节点数 | 20,000 | 一个关闭页面。 |
| 单页文档深度 | 32 | 一个关闭页面。 |
| 单个 HTML fragment | 16 MiB | 一个 Page 或 overlay 的双语最终 HTML fragment bytes。 |
| shell 与 fragments | 256 MiB | 一次 revision 的根 shell 与全部 fragment bytes。 |
| 全站构建时间 | 120 秒 | 从固定 Sample 打开到 revision bytes 完成。 |
| 构建 RSS 增量 | 1.25 GiB | 单次全站构建相对启动参照值的最大常驻内存增量。 |
| 下载文件数 | 1,000 | 一次 revision。 |
| 单个下载文件 | 32 MiB | 一个规范化下载文件。 |
| 单个 Source asset | 8 MiB | 一个 Source 文件的站点 asset。 |
| 单个 Diff asset | 4 MiB | 一个 Diff 文件的站点 asset。 |
| 全部 Source 与 Diff asset | 128 MiB | 一次 revision 的这两类 asset 合计。 |
| 全部静态 asset | 256 MiB | CSS、script、Source、Diff 与作者 asset 合计。 |

RSS 启动参照值在 Host 打开本次 Record-backed 固定 Sample 之前取得；同一个参照值持续约束 Sample 打开、全部 Page closure 与最终 revision bytes，
直到签名完成。预算比较的是本次构建造成的 RSS 增量，而不是把 CLI 启动、模块装载及同进程其它既存常驻内存误算为报告输出；
错误中的 `observedAtLeast` 给出已观测到的增量 bytes。
该上限以完整 MemoryBench dogfood 的线性 Page closure 为大型 Sample 参照结果，并保留运行时与平台差异余量；它不能通过缩小 selector、
跳过 Page 或把 payload 延后到浏览器读取来满足。

Source 与 Diff 不会因达到某个阈值而被偷偷改成浏览器按需读取。默认组件把受限摘要和允许内联的正文直接关闭进 HTML fragment；
`DiffView` 的 patch 内联上限固定为单文件 64 KiB、单个组件 512 KiB，超过上限的文件保留摘要与公开下钻命令。只有 Page closure
明确产出 `kind: "source"` 或 `kind: "diff"` 的关闭 asset 时，它才成为独立静态文件，并分别受 8 MiB、4 MiB 与合计 128 MiB
上限约束。无论哪种形态，浏览器都不能回读 Record 或 Analysis；超过 HTML 或 asset 上限时整站构建失败。

## watch 与发布

watcher 观察 Record root、Report module、项目内静态 import、theme 与配置。每个变化信号形成 build intent；最新 intent 具有发布权，
较早 intent 可以中止，或在结束后丢弃。

Record snapshot identity、selection、Report module closure、renderer、theme 与 locale 共同组成 build fingerprint。
Profile content identity、asset 集合和 projection bytes 也锁入该 fingerprint。若 Record 信号对应的 snapshot identity 与当前
revision 相同，Host 保留当前 revision，不重新打开 Sample，也不再次调用 Analysis。

每次有效 watch intent 都走同一个完整 revision builder；Host 不缓存 Page bytes，也不从旧 fragment 或 theme bytes 重签 revision。
builder 完成 Sample、Analysis、Page closure、fragment、shell、asset 与 identity 后才产生唯一候选。

只有最新 intent 完整通过校验，Host 才原子替换 current revision。失败保留 last-good；一个 HTTP request 在开始时固定 revision 引用，
响应期间不会混入另一版本的页面、asset 或下载 bytes。

## 机器数据的 owner

内建报告的机器数据由 Host 在同一次目标执行中以具名领域结果生成。自定义报告只能得到 target-execution manifest：它包含选中 Page
的 route、标题、rendered text、下载摘要和问题表，不含 React tree、site revision、revision identity 或任意作者数据对象。
其中 rendered text 固定为该 Page 已关闭的英语 80-column text projection；它不随 TTY 或浏览器宽度变化，也不会触发第二次执行。

CLI 固定这些文档的 format、locale、目标选择和 canonical order；详见 [CLI](cli.md#niceeval-show---json)。机器数据不是组件第三面。

## 仓库 E2E 与候选包 dogfood

仓库 E2E 使用小型代表 fixture：两个 sealed Run、五个 logical Slot、一个 partial MetricValue、一个 Attempt overlay、一个 Source overlay 和
一个 Diff overlay。它证明标准 React JSX、`show` 单目标调用次数、参数成员资格、内建与自定义 JSON、完整 hash target 集、
view/static bytes、reload 静默停用与 last-good。

完整 MemoryBench 只用于安装后的候选包 dogfood。它在隔离 consumer 中安装同一候选包，再经公开 `show`、`view` 和 static 路径阅读；
它不作为仓库 E2E fixture，不从相邻源码读取 Report，也不替代小型代表 fixture。

## 不变量

- `show` 只执行一个已选择 Page，且不产生 revision。
- 参数化 show 先完成 decode 与 canonical encode，并在 `load` / DomainView 边界验证 Sample 成员资格。
- view 与 static 从同一个完整 `ClosedSiteRevision` 读取同一个根 shell、HTML fragments、CSS、app client、asset 和下载 bytes。
- 零选中结果的 Sample 不能形成全站 revision；已选中结果中的 empty MetricValue 仍是可呈现数据。
- `ResolvedPage` 只在 Host 内部短存；公开作者面没有 generic semantic tree。
- watch 更新不建立 fragment 重签或 Page-bytes 快速路径。
- 失败不会替换 last-good revision；数据问题保持可见，构建错误不会发布部分站点。

## 相关阅读

- [Report Library](library.md)：公开 export manifest、Page、组件与作者边界。
- [Reports CLI](cli.md)：选择、单目标 show、JSON、view 与静态导出。
- [分享静态报告站](use-case/分享静态报告站.md)：断网阅读与完整目录。
