# `niceeval view` —— 在浏览器读结果

`niceeval view` 把结果根呈现为本地网页：内容全部来自装载报告的 pages（不带 `--report` 时是[内建报告](library/built-in.md)的报告、Attempts、追踪三张导航页，加一张不进导航的 attempt-input page）。view 只拥有 page / locator 寻址、导航与 dialog 摆放，不拥有详情区块。它不依赖外部服务。

本地模式与静态导出共用**同一条站点管线**：管线的输入是结果根加可选收窄（位置参数 / `--exp`）。收窄把根滤成只含匹配实验与 attempt 的**有效根**。管线把 scope-input pages 物化进 `index.html`；若报告声明了 attempt-input page，再为每个可达 locator 把同一张 page 物化为 `attempt/<locator>.html`；`artifact/` 则携带前端会读取的证据文件。本地模式按路径服务这份产物，`--out` 把同一份产物写盘；同一输入下同一路径逐字节一致。宿主不携带 page 的取数或布局知识。

## 打开与收窄

```sh
niceeval view
niceeval view weather                  # eval id 前缀，只收窄报告槽
niceeval view --exp agents/codex       # 按 experiment id 路径收窄
niceeval view --exp agents/codex/gpt-5.4 # 只看一个 experiment
niceeval view --results site-data/run  # 换结果根
niceeval view --snapshot .niceeval/dev-e2b_codex-e2b/2026-07-12T10-08/snapshot.json
                                       # 只打开这一份快照
niceeval view --no-open                # 只打印 URL
niceeval view --port 4400              # 固定本地端口
niceeval view --report reports/exam.tsx
niceeval view --report reports/site.tsx --page exam   # 多页报告，指定初始页
```

位置参数只有一种含义：eval id 前缀，与 `show` 一致。结果根用 `--results <dir>` 传入，单开一份快照用 `--snapshot <file>`——文件与目录都不进位置参数，位置参数的含义不随文件系统状态改变。

本地 server 只监听 `127.0.0.1`。默认让操作系统随机分配端口；`--port <n>` 指定首选端口，被占用时从 n 起向上顺延最多 20 个，全被占用才报错。

裸 `niceeval view` 默认把结果根中的完整 Scope 交给 scope-input pages。`--exp` 按 experiment id 路径收窄，位置参数按 eval id 前缀收窄；两者可组合取交集。locator URL 选择报告中唯一的 attempt-input page，并从有效根把 locator 解析为一份 `AttemptEvidence` 注入它——收窄之内、即使不在现刻水位里的历史 attempt 也能打开；收窄之外的 attempt 不可达。同一份收窄交给 `--out` 时决定出站内容。

## 页面构成

- **导航机器与品牌位：** 页头左端是报告改不动的恒定 NiceEval 字标（外链官网），右侧是 page 导航、外部链接与语言切换。导航只列报告中 `navigation !== false` 的 pages，按声明顺序排列——裸 `view` 的「报告 / Attempts / 追踪」三个 tab 是内建四张 pages 中的前三张，参数化详情页不进导航。宿主不追加导航项。浏览器标题、外壳链接、页脚与资产仍按[外壳契约](library/shell.md#行为约束)消费；hero、品牌行和警告区都是 page 内[站点组件](library/site-components.md)。
- **默认报告页（内建首页）：** 页首是 `Hero`、`ScopeWarnings` 与 `CopyFixPrompt`，随后 `ExperimentComparison` 直接展示当前 Scope 的摘要、成本 × 端到端通过率散点和 experiment 比较表。每个 experiment 的 eval 集来自快照记录的 `selectedEvalIds`；未选择的 eval 不进入该 experiment 的分母。散点 series 有 label `line` 时按线归类并绘制折线，否则按 agent 归类、不连线。实验表一行一个 experiment，可展开查看 eval 与 attempt 证据。`--report` 用自定义报告文件替换整份页面声明。
- **Attempts 页（内建）：** `Hero` + `ScopeWarnings` + 带过滤的 [`AttemptList`](library/entity-lists.md#attemptlist)，把范围内所有 attempt 展成可筛选列表；页名与全库的 attempt 术语一致。
- **追踪页（内建）：** `Hero` + `ScopeWarnings` + [`TraceWaterfall`](library/site-components.md#tracewaterfall)，用 canonical OTel 字段显示每个 attempt 的执行瀑布行。
- **Attempt 详情（内建第四张 page）：** `standard` 声明一张 `input: "attempt"`、`navigation: false` 的 page，content 是普通 [`AttemptDetail`](library/attempt-detail.md) 组合组件。它再用 `AttemptSummary`、`AttemptAssessment`、`AttemptFixPrompt`、`AttemptTimeline`、`AttemptDiagnostics`、`AttemptUsage`、`AttemptConversation`、`AttemptTrace`、`AttemptDiff` 组装判定、断言、修复 prompt、时间树、diagnostics、usage、对话、trace 和 diff。以下是这些组件的 web 面契约，不是 view 硬编码布局：`AttemptAssessment` 有源码时用 `AttemptSource`，否则用 `AttemptAssertions`；`AttemptTimeline` 组合 runner phase 与显式关联的 spans；`AttemptTrace` 保留原始 OTel 视角；`AttemptConversation` 按标准事件流分轮。用户可把 page content 换成任意公开组件组合。
- **Copy fix prompt：** 全部失败的批量修复 prompt 由内建报告页里的 [`CopyFixPrompt`](library/site-components.md#copyfixprompt) 组件提供；attempt 详情里保留单条失败的复制入口。

## 静态导出

```sh
niceeval view --out site                            # 导出完整结果根
niceeval view --exp agents/codex --out site      # 只发布一个 experiment 路径范围
niceeval view weather --out site                    # 只发布匹配 eval id 前缀的部分
niceeval view --results site-data/run --out site    # 对 copySnapshots 产出的发布根导出
```

`--out` 把站点产物原样写进一个目录，不设确认关卡。**出站的就是收窄到的**：位置参数 / `--exp` 是站点管线的输入，对本地与导出同义——页面 Scope 与 `artifact/` 证据树跟随同一份收窄，被滤掉的实验与 attempt 的证据文件不出站，对它们的深链在导出站如实显示证据缺失。等价说法：`view <收窄> --out` 就是先把根滤成只含匹配部分、再对这份根导出；不收窄时导出完整结果根。页面能引用的 attempt 恒在产物内（页共享同一份收窄后的 Scope），站内的证据引用不会因收窄断链。发布给谁、内容是否适合公开，在选择收窄与构建结果根时决定（瘦身与更复杂的挑选见 [`copySnapshots`](../results/library.md#复制与瘦身copysnapshots)）。输出恒为目录：

```text
site/
├── index.html
├── attempt/                 # 当前报告声明 attempt-input page 时出现；文件名是 URL 编码后的 locator
│   └── <locator>.html       # 同一张 page 对一份 AttemptEvidence 的完整静态 web 面
├── assets/                  # 外壳 scripts / styles 的 {src} 资产与 head 标签的本地 src/href 资产，按内容哈希命名
└── artifact/
    └── <snapshot-path>/
        ├── sources/
        │   └── <sha256>.json    # 快照级源码去重仓库；attempt 的 sources.json 只是引用，正文在这里
        └── <attempt-path>/
            ├── sources.json     # {path, sha256} 引用列表
            ├── events.json
            ├── trace.json
            └── diff.json        # 根里有才出现；缺时证据位置如实显示缺失
```

站内 `artifact/` 树因此自包含：其中 `sources.json` 按引用指向同快照的 `sources/<sha256>.json`，读取这份导出目录的下游消费方（下载后用 `niceeval/results` 重新打开、或另行编写的查看器）按这条引用取源码正文；携带条目（`artifactBase` 指向原快照）的源码正文由复制管线归拢进本快照的 `sources/`，静态站不需要原快照在场。这是 `artifact/` 自身的存储去重机制，与页面渲染路径无关——`AttemptSource` 消费的标注源码已经在 `AttemptEvidence.evalSource` 里解引用好，构建期直接写进对应 attempt 页面的初始 HTML，不依赖浏览器再去读这份引用。

多页报告仍只用一个 `index.html`：页面是 `#/page/<id>` 路由，托管方不需要为每页配置路径。attempt 不同：基线 locator 链接直接指向 `attempt/<locator>.html`，保证无 JavaScript 也能读完整详情；增强脚本拦截后才把同一文档内容放进 dialog，并把浏览状态写成 `#/attempt/@<locator>`。所有 HTML 都按自身相对位置生成 `assets/` / `artifact/` 引用，所以站点根、子目录、直接打开文件与常见 cleanUrls 托管都不断链。`assets/` 只在外壳声明了本地资产（`scripts` / `styles` 的 `{src}`，或 `head` 标签 `attrs` 里的本地 `src` / `href`）时出现；资产按 `assets/<sha256><ext>` 写入并改写 HTML 引用，同内容且同扩展名的资产去重，不受源文件同名影响。`head` 里的外链（`http(s)://`）不进 `assets/`，原样落在标签上由读者浏览器加载。导出的站点会原样携带并在读者浏览器执行这些脚本，发布防呆不检查脚本内容。attempt 页面的基线内容——判定、断言、时间树、对话、diagnostics、usage、trace、diff 摘要与可展开细节——已经在构建期写进该 locator 的静态 HTML，不依赖浏览器再去 fetch；`artifact/` 是与 HTML 平行的独立证据树，只服务下载、外部程序读取与渐进增强的补充链接，不是页面基线内容的数据来源。因此不提供“单个 HTML”导出：站点仍需要 `assets/`（样式 / 脚本）与 `artifact/`（独立证据文件）等外部文件，这是站点由多个物理文件构成的结构性原因，与页面是否需要联网取数无关。

导出没有档位：`view --out` 不做体积取舍，收窄范围内存在且前端会读取的证据文件——`sources.json` 及其引用的快照级 `sources/<sha256>.json` 正文、`events.json`、`trace.json`、`diff.json`——全部随站复制，缺的在对应证据位置如实显示缺失，不猜也不冒充。体积取舍不在导出层做：要瘦站点，在构建发布根时用 [`copySnapshots({ artifacts })`](../results/library.md#复制与瘦身copysnapshots) 决定带什么（其缺省不带 diff）。唯一永不复制的是 `o11y.json`——报告数字在导出时已烘进 HTML，浏览器不读它，这是「前端读什么带什么」规则的推论，不是一个档位。

**命令行收窄管选择实验与 eval，`copySnapshots` 管导出参数表达不了的构根。** 按实验或 eval id 前缀发布，直接用位置参数 / `--exp` 收窄导出。需要更多控制时先用 [`copySnapshots`](../results/library.md#复制与瘦身copysnapshots) 构建发布根，再对发布根导出——它覆盖三类场景：瘦身（`artifacts` 挑证据种类）、任意谓词挑选快照（收窄只有前缀语义），以及把发布根作为数据签进仓库长期托管：

```ts
const results = await openResults(".niceeval");
await copySnapshots(results.latest(), "site-data/run", {
  artifacts: ["sources", "events", "trace"],   // 瘦身：不带 diff
});
// 然后：niceeval view --results site-data/run --out site
```

反过来，「报告聚焦某实验、证据保持全量」是看法层的事，在报告文件里表达——组件 `input` 传收窄后的 Scope，导出时不收窄。

`artifact/` 由与 [`copySnapshots()`](../results/library.md#复制与瘦身copysnapshots) 同一条复制管线产出（同一 50 MiB 预检、同一布局知识）。导出的产物包含收窄范围内**完整的原始证据**——prompt、工具参数、完整输出、源码——深链一点开就是原文；运行环境注入的秘密由格式在采集侧挡在结果文件之外（[Results · 复制与瘦身](../results/library.md#复制与瘦身copysnapshots)）。

## 结果版本与错误

扫描整个结果根时，单个不可读快照不会挡住其它结果；每个被跳过的快照形成一条 `unreadable-snapshot` [Scope warning](../results/library.md#警告-kind-全集)（含目录与原因），由页内的 `ScopeWarnings` 组件与其它选择警告一起显示。用 `--snapshot` 明确指定单个快照文件时，该文件不可读会让命令失败。

| 场景 | 行为 |
|---|---|
| 非 niceeval JSON | 忽略 |
| schemaVersion 不兼容 | 跳过并建议用产出它的 niceeval 版本打开 |
| JSON 损坏或必需字段错误 | 标为 malformed |
| attempt 已写入但缺 `snapshot.json` | 标为 incomplete |
| 单个 attempt 缺可选 artifact | 页面可打开，在该证据位置显示缺失 |

零可读结果时，本地 server 不启动，`--out` 也不会生成空站。读取不会迁移或改写历史结果。

## 自定义报告与外壳

```sh
niceeval view --report reports/exam.tsx               # 树形态：报告树替换默认外壳的报告槽
niceeval view --report reports/site.tsx               # 配置对象形态：品牌外壳 + 多页导航
niceeval view --report reports/site.tsx --page exam   # 指定初始页
```

报告文件同时可被 `niceeval show --report` 使用。官方组件都有 web 和 text 两个渲染面，所以同一张 page 在浏览器和终端保持相同数据口径；view 注入静态详情链接与 dialog 路由，show 注入带完整 `--report` 上下文的 locator 命令。写法见 [Library](library.md#交给-show--view-渲染)。

`--report` 文件的默认导出恒为 `defineReport` 产物：树形态展开为单张 scope-input page；[配置对象形态](library/shell.md)声明外壳与 pages。view 只把 `navigation !== false` 的 pages 列进导航；scope-input page 读取 Scope，attempt-input page 按 locator 读取 `AttemptEvidence`。`--page <id>` 未命中或试图在没有 locator 时打开参数化 page，均按完整用户反馈报错。

`ExperimentComparison` 的两个渲染面共享同一份实体与指标数据：web 面使用可排序的实验表，text 面使用紧凑列表；两面都直接消费完整 Scope，不设实验组选择器。端到端通过率、成本、耗时、Tokens、判定构成和证据引用来自同一份计算结果。

## 相关阅读

- [Show](show.md) —— 同一批结果的终端入口。
- [Reports Library](library.md) —— 自定义报告槽；外壳与多页见[分篇](library/shell.md)。
- [Results](../results/README.md) —— view 读取与导出的数据。
- [Architecture](architecture.md) —— 报告宿主与「宿主只剩机器」的边界清单。
