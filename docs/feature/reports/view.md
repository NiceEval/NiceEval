# `niceeval view` —— 在浏览器读结果

`niceeval view` 把记录根呈现为本地网页：可见内容来自装载报告的 pages。
装载哪一份按 `--report` → 项目配置的 `report` 字段 → 内建 `standard` 的[三档取值链](README.md#项目默认报告)决定；两处都没有时是[内建报告](library/built-in.md)的报告、Attempts、追踪三张导航页，加一张不进导航的 attempt-input page。
自定义报告没有声明 attempt-input page 时，view 隐式使用官方 `AttemptDetails` page，保证官方组件里的 locator 仍可下钻；显式声明则覆盖它。
view 只拥有 page / locator 寻址、导航与 dialog 摆放，不拥有另一套详情区块。
它不依赖外部服务。

本地模式与静态导出共用**同一条站点管线**：管线的输入是记录根加可选收窄（位置参数 / `--exp`）。
收窄把根滤成只含匹配实验与 attempt 的**有效根**。
管线把每张 sample-input page 按界面语言渲染成一块报告 HTML，再为每个可达 locator 把显式或隐式的 attempt-input page 物化为 `attempt/<locator>.html`。
`index.html` 是承载报告块的外壳，`artifact/` 携带前端会读取的证据文件。
宿主不携带 page 的取数或布局知识。

照构建工具的心智读这两种模式最省事：**`--out` 是 build，不带选项的 `view` 是同一个 build 挂上 watch，再加一个本地 server**。
差别只有建完之后停不停——`--out` 建一次、写盘、退出；本地模式建完起 server，然后盯着输入[持续重建](#持续重建)。
每一次重建都是同一条管线的完整重跑，页面上换掉的那一块是重建后的新产物，不是对旧产物的差分。

**本地看到的就是发出去的，量的是块，不是文件布局。**
同一输入下，同一页同一语言的那块报告 HTML 在两个宿主下逐字节一致，`attempt/`、`assets/` 与 `artifact/` 同路径逐字节一致。
报告块住在哪个文件里按宿主能力分：

| 宿主 | 报告块的投递 | 为什么 |
|---|---|---|
| `--out` | 全部页与语言预烘进 `index.html` | 导出产物要脱离 server 读，`file://` 直接打开也不能靠 fetch 取块 |
| 本地模式 | `index.html` 只预烘浏览器当前订阅的那一块，其余在 `report/<pageId>.<locale>.html` 按需渲染 | server 在场，切页时取一次即可，重建因此不必渲染看不见的块 |

## 打开与收窄

```sh
niceeval view
niceeval view weather                  # eval id 前缀，只收窄报告槽
niceeval view --exp agents/codex       # 按 experiment id 路径收窄
niceeval view --exp agents/codex/gpt-5.4 # 只看一个 experiment
niceeval view --record site-data/run  # 换记录根
niceeval view --fresh                  # 只统计最新一次运行实测的 attempt
niceeval view --run .niceeval/dev-e2b_codex-e2b/2026-07-12T10-08/run.json
                                       # 只打开这一份 Run
niceeval view --no-open                # 只打印 URL
niceeval view --port 4400              # 固定本地端口
niceeval view --report reports/exam.tsx
niceeval view --report reports/site.tsx --page exam   # 多页报告，指定初始页
niceeval view --report standard        # 内建视图名，回到默认报告
niceeval view --theme ./themes/acme.ts # 换一份主题，不动报告文件
```

位置参数只有一种含义：eval id 前缀，与 `show` 一致。
记录根用 `--record <dir>` 传入，单开一份 Run 用 `--run <file>`——文件与目录都不进位置参数，位置参数的含义不随文件系统状态改变。

本地 server 只监听 `127.0.0.1`。
默认让操作系统随机分配端口；`--port <n>` 指定首选端口，被占用时从 n 起向上顺延最多 20 个，全被占用才报错。

不带选项的 `niceeval view` 默认把记录根中的完整 Sample 交给 sample-input pages。
`--exp` 按 experiment id 路径收窄，位置参数按 eval id 前缀收窄；两者可组合取交集。
`--fresh` 注入只含新执行 attempt 的 [`fresh` 口径](../sample/library.md#时效新执行与历史执行)，被排除的题按覆盖事实转为占位行。
locator URL 选择报告中唯一的 attempt-input page，并从有效根把 locator 解析为一份 `AttemptEvidence` 注入它——收窄之内、即使不在现刻水位里的历史 attempt 也能打开；收窄之外的 attempt 不可达。
同一份收窄交给 `--out` 时决定出站内容。

## 持续重建

本地模式建完站点起 server，然后盯着输入继续重建。
它服务两种坐着不动的循环：

- **一边跑一边看。**
  `niceeval exp` 每写完一个 attempt，页面上就多一行，不必反复重开命令。
- **一边改报告一边看。**
  改报告或组件文件存盘，浏览器里那一页就换成新样子，当前 tab、滚动位置与打开的 attempt dialog 都留在原处。

### 重建理由是一个闭集

盯的输入是闭集，逐条对应一种「站点会因此不同」的原因：

| 输入 | 触发重建的事件 |
|---|---|
| 有效根内的记录 | 新 Run 目录、新写出的 `result.json` 与证据文件、`run.json` 补写 `completedAt` |
| 报告文件与它的整棵 import 图 | 改 `--report` 指向的文件，或改它 import 的**自定义组件**、读数、工具模块；项目配置的 `report` 字段同理 |
| 主题文件与它的 import 图 | 改 `--theme` 指向的主题或它 import 的令牌模块 |
| 项目配置 | `niceeval.config.ts` |

**改组件代码同样重建。**
报告是一棵组件树，自定义 renderer 或普通报告函数写在哪个文件里都算报告的一部分。
监听覆盖报告文件的整棵项目内 import 图，不是只看入口文件。
所以「改一个组件的 web 面 → 存盘 →浏览器里看到新样子」是本地模式的常规写法，与改报告文件本身没有区别。

**闭集之外没有第二条重建理由。**
打开页面、刷新浏览器、切页与切语言都不是重建理由：盘上没变，产物就还是上一次那份，请求直接命中它。
所以这张表不只回答「什么会自动刷新」，它同时是「什么改了会生效」的完整答案——手动刷新不构成绕过闭集的旁路。

不盯的有三类：有效根之外的记录、依赖目录里的包、临时写入文件。
收窄之外的数据本来就不进站点，为它重建只会让页面无故闪动；`niceeval` 自己的内建组件随包分发，改它属于开发 niceeval，不是用这条命令。

### 变更分两类，失效到不同深度

闭集里的两类变更失效范围不同：

| 变更类别 | 重新装载模块图 | 重跑管线 |
|---|---|---|
| 有效根内的记录 | 否 | 是 |
| 闭集里的模块文件（报告、主题、配置及其 import 图） | 是 | 是 |

模块图一个文件都没变时，重新装载它得到的是同一份定义，代价却是把整棵图连同 `niceeval`自身重新求值一遍。
所以记录变更沿用上一次装载出的报告与主题定义，只重跑管线。

这一分流分的是「定义要不要重读」，不是「数要不要重算」——两类变更下管线都从头跑满。

### 重建语义

- **整条管线重跑，没有增量档位。**
  重新扫记录根、重新选 Sample、重新解析组件树、重新渲染。
  一个 attempt 落盘会改变覆盖分母和全部聚合数字，「只追加一行」算出来的数与全量重建不一致——那正是[跨层不变量](../reading/README.md#跨三层的不变量)第一条要挡的东西。
- **事件去抖后合成一次重建。**
  一次运行收尾时多个 artifact 连续落盘，合成一次。
  重建期间又来事件，在本次结束后再建一次，不排队堆积。
- **失败不拆站。**
  报告文件写错、配置报错时 server 继续服务上一份可用站点，把结构化错误推给浏览器显示、终端同步打印一次；修好保存后自动恢复。
  `--out` 遇到同样的错误按用法错误非零退出——它没有「上一份」可留。

### 只渲染看得见的那一块

本地模式下，浏览器订阅重建事件时声明自己在看哪一页、哪种语言，重建只渲染这一块。
其余页与语言是清单里的 `report/<pageId>.<locale>.html`，切过去时才渲染。
一份三页报告在两种语言下是六块，一次重建从渲染六块变成渲染一块，与报告有多少页无关。

`--out` 没有「当前订阅」可言，六块全部渲染并预烘进 `index.html`。
同一页同一语言在两个宿主下是同一份字节，差别只有渲染时机——这正是开篇那条同一性量的东西。

### 页面就地换内容

重建完成后 server 把结果推给已经打开的页面，分两档：

| 变更 | 推送内容 | 页面行为 |
|---|---|---|
| 报告块（页面 HTML 与视图数据） | 订阅中那一页的新 HTML | 就地换掉报告块，其余不动 |
| 外壳（`styles`、`scripts`、`head` 资产、主题令牌） | 一条重载指令 | 整页重载 |

**外壳变化整页重载，因为它改的是文档本身。**
样式表、脚本与 `head` 标签住在 `<head>` 里，就地替换要重放整套加载顺序，比重载一次更难解释、也更容易留下半套状态。
报告块不同：它是文档里一个可替换的区域，换掉它不动其它任何东西。
走哪一档由 server 按外壳指纹判定，不给作者开关。

就地换内容保住的是**手上的位置**：翻到第 40 个 attempt、开着某条 trace 的 dialog、过滤条里打了字——改一行组件代码不该把这些清零。
报告块内部的展开状态跟着新 HTML 走，内容本身换了，它的展开状态没有可继承的对应物。

两档都保留当前路由（`#/page/<id>` 与 `#/attempt/@<locator>`）。
正在看的 attempt 在重建后仍在有效根内就停在原处；被收窄之外的新数据不影响页面。

与正在运行的实验的关系由记录格式担保，不靠 view 自己防抖：`result.json` 一次原子写成，站点只会看到已封口的 attempt，读不到半份记录。
Run 尚未补写 `completedAt` 是这个场景的常态，按[未收尾 Run](../record/architecture.md#读取规则) 如实读出并产生读取期 Issue，不等收尾才显示。

**没有关掉持续重建的 flag。**
本地模式的存在理由就是盯着看；要一份静止不动的快照，那就是 `--out` 的产物，用浏览器直接打开即可。

## 页面构成

- **导航机器与品牌位：** 页头左端是恒定的 NiceEval 字标，右侧是 page 导航、外部链接与语言切换。
  导航只列 `navigation !== false` 的 pages，并按声明顺序排列；参数化详情页不进导航，宿主不追加项。
  浏览器标题、外壳链接、页脚与资产按[外壳契约](library/shell.md#行为约束)消费；hero、Notice 和 Run 诊断都是 page 内的[站点组件](components/site/README.md)。
- **默认报告页（内建首页）：** 页首是 `Hero`，随后是首页任务函数产出的 Notice、摘要、成本 × 主读数 points 和 Experiment rows。
  实验表可展开查看 Eval 与 attempt 证据。
  每个 experiment 的 eval 集取 Run 记录的 `selectedEvalIds`，未选择项不进入分母。
  散点有 `line` label 时按线归类并连线，否则按 agent 归类且不连线。
  `--report` 用自定义报告替换整份页面声明，配置的 `report` 字段把同一替换设为项目默认。
- **Attempts 页（内建）：** `toAttemptRows(sample.attempts)` 把范围内所有 Attempt 投影成 rows，再交给带过滤的 `Table`。
- **追踪页（内建）：** `toTraceNodes(sample)` 用 canonical OTel 字段产生执行时间树，再交给 `Waterfall`。
- **Attempt 详情（内建第四张 page）：** `standard` 声明一张 `input: "attempt"`、`navigation: false` 的 [`AttemptDetails`](components/attempt-detail/README.md) page。
  它用公开组件装配判定、断言、修复 prompt、时间树、usage、对话、trace 和 diff。
  `AttemptAssessment` 内的`AttemptNotices` 统一解释 snapshot error 与 persisted diagnostics。
  用户可把 content 换成任意公开组合。
- **Copy fix prompt：** 批量修复 prompt 由[`SampleFixPrompt`](components/summaries/sample-fix-prompt.md) 提供；attempt 详情保留单条失败的复制入口。

## attempt 详情的 dialog 摆放

locator 链接在浏览器里打开的是同一张 attempt-input page 的同一份 web 输出：基线链接直达 `attempt/<locator>.html`，增强脚本拦截后把那份内容放进 dialog，并把浏览状态写成 `#/attempt/@<locator>`。
dialog 是摆放，不是第二套内容（区块与字段见 [详情的呈现](components/attempt-detail/presentation.md)）。

宿主在这层只负责下面这些机器：

| 行为 | 契约 |
|---|---|
| 打开 | 点击 locator 链接，或直接落在 `#/attempt/@<locator>` 深链上 |
| 关闭 | 关闭按钮、`Esc`、点击遮罩三条等价 |
| 关闭后的地址 | 点链接打开的走一次后退，深链落地的原地抹掉 hash，不把读者弹出站外 |
| 焦点 | 打开时焦点进入 dialog 并留在内部，关闭后回到原处 |
| 滚动 | 宿主只给纵向滚动，且锁住背景页；横向滚动归组件自己（源码块整块横滚） |
| 取不到内容 | 不开空 dialog；控制台说明哪个 locator 取不到 |
| 修饰键点击 | 放行浏览器原生行为，在新标签页打开那份独立文档 |

内容宽度与最大高度由壳给定，页面内容不为弹窗换一套排版：同一个 locator 在独立文档里与在 dialog 里是同一份字节。
无 JavaScript 时链接照常导航到独立文档，详情完整可读。

## 静态导出

```sh
niceeval view --out site                            # 导出完整记录根
niceeval view --exp agents/codex --out site      # 只发布一个 experiment 路径范围
niceeval view weather --out site                    # 只发布匹配 eval id 前缀的部分
niceeval view --record site-data/run --out site    # 对 publish 产出的发布根导出
```

`--out` 把站点产物原样写进一个目录，不设确认关卡。**
出站的就是收窄到的**：位置参数 / `--exp` 是站点管线的输入，对本地与导出同义——页面 Sample 与 `artifact/` 证据树跟随同一份收窄，被滤掉的实验与 attempt 的证据文件不出站，对它们的深链在导出站如实显示证据缺失。
等价说法：`view <收窄> --out` 就是先把根滤成只含匹配部分、再对这份根导出；不收窄时导出完整记录根。
页面能引用的 attempt 恒在产物内（页共享同一份收窄后的 Sample），站内的证据引用不会因收窄断链。
发布给谁、内容是否适合公开，在选择收窄与构建记录根时决定（瘦身与更复杂的挑选见 [`publish`](../record/library.md#发布publish)）。
输出恒为目录：

```text
site/
├── index.html
├── attempt/                 # 每个可达 locator 的详情文档；文件名是 URL 编码后的 locator
│   └── <locator>.html       # 同一张 page 对一份 AttemptEvidence 的完整静态 web 面
├── assets/                  # 外壳 scripts / styles 的 {src} 资产与 head 标签的本地 src/href 资产，按内容哈希命名
└── artifact/
    └── <run-path>/
        ├── sources/
        │   └── <sha256>.json    # Run 级源码去重仓库；attempt 的 sources.json 只是引用，正文在这里
        └── <attempt-path>/
            ├── sources.json     # {path, sha256} 引用列表
            ├── events.json
            ├── trace.json
            └── diff.json        # 根里有才出现；缺时证据位置如实显示缺失
```

站内 `artifact/` 树因此自包含：其中 `sources.json` 按引用指向同 Run 的`sources/<sha256>.json`。
携带条目的源码正文由复制管线归拢进本 Run 的`sources/`，静态站不需要原 Run 在场。
这个存储去重机制与页面渲染路径无关：`toAnnotatedEvalSource(attempt)` 消费的源码已在 AttemptEvidence 中解引用，构建期直接写进对应 Attempt 页面的初始 HTML。

多页报告仍只用一个 `index.html`：页面是 `#/page/<id>` 路由，托管方不需要为每页配置路径。
attempt 不同：基线 locator 链接直接指向 `attempt/<locator>.html`，保证无 JavaScript 也能读完整详情；增强脚本拦截后才把同一文档内容放进 dialog，并把浏览状态写成 `#/attempt/@<locator>`。
所有 HTML 都按自身相对位置生成 `assets/` / `artifact/` 引用，所以站点根、子目录、直接打开文件与常见 cleanUrls 托管都不断链。
托管方把站点根暴露成无尾斜杠路径（`/showcase/memory` 直接服务 `index.html`，且带斜杠形态被 308 回无斜杠）时，浏览器按文档 URL 的**目录**解析相对引用会少一层——`index.html` 因此在 `<head>` 最前面落一个 `<base>`，把站点根写成目录形态，后续所有相对引用（attempt 链接、证据 fetch、head 资产标签）都按它解析：路径已是目录形态（`/`、`/sub/`）时不插入，末段带扩展名（`/out/index.html`、`file://` 直接打开）时取其目录。
`index.html` 按构造恒是站点根，这条判定不需要托管方配置。
attempt 文档住在真实的 `attempt/` 目录下，相对引用天然对齐，不参与这套归一。
`assets/` 只在外壳声明了本地资产（`scripts` / `styles` 的 `{src}`，或 `head` 标签 `attrs` 里的本地 `src` / `href`）时出现；资产按 `assets/<sha256><ext>` 写入并改写 HTML 引用，同内容且同扩展名的资产去重，不受源文件同名影响。
`head` 里的外链（`http(s)://`）不进 `assets/`，原样落在标签上由读者浏览器加载。
导出的站点会原样携带并在读者浏览器执行这些脚本，发布防呆不检查脚本内容。
attempt 页面的基线内容——判定、断言、时间树、对话、diagnostics、usage、trace、diff 摘要与可展开细节——已经在构建期写进该 locator 的静态 HTML，不依赖浏览器再去 fetch；`artifact/` 是与 HTML 平行的独立证据树，只服务下载、外部程序读取与渐进增强的补充链接，不是页面基线内容的数据来源。
因此不提供“单个 HTML”导出：站点仍需要 `assets/`（样式 / 脚本）与 `artifact/`（独立证据文件）等外部文件，这是站点由多个物理文件构成的结构性原因，与页面是否需要联网取数无关。

导出没有档位：`view --out` 不做体积取舍，收窄范围内存在且前端会读取的证据文件——`sources.json` 及其引用的 Run 级 `sources/<sha256>.json` 正文、`commands.json`、`events.json`、`trace.json`、`diff.json`——全部随站复制，缺的在对应证据位置如实显示缺失，不猜也不冒充。
体积取舍不在导出层做：要瘦站点，在构建发布根时用 [`publish({ artifacts })`](../record/library.md#发布publish) 决定带什么（其默认不带 diff）。
唯一永不复制的是 `o11y.json`——报告数字在导出时已烘进 HTML，浏览器不读它，这是「前端读什么带什么」规则的推论，不是一个档位。

**命令行收窄管选择实验与 eval，`publish` 管导出参数表达不了的构根。**
按实验或 eval id 前缀发布，直接用位置参数 / `--exp` 收窄导出。
需要更多控制时先用 [`publish`](../record/library.md#发布publish) 构建发布根，再对发布根导出——它覆盖三类场景：瘦身（`artifacts` 挑证据种类）、任意谓词挑选 Run（收窄只有前缀语义），以及把发布根作为数据签进仓库长期托管：

```ts
const results = await openRecord(".niceeval");
await publish(latestRunSample(record), "site-data/run", {
  artifacts: ["commands", "sources", "events", "trace"],   // 瘦身：不带 diff
});
// 然后：niceeval view --record site-data/run --out site
```

反过来，「报告聚焦某实验、证据保持全量」是看法层的事，在报告文件里表达——组件 `input` 传收窄后的 Sample，导出时不收窄。

`artifact/` 由与 [`publish()`](../record/library.md#发布publish) 同一条复制管线产出（同一 50 MiB 预检、同一布局知识）。
导出的产物包含收窄范围内**完整的原始证据**——prompt、工具参数、完整输出、源码——深链一点开就是原文；运行环境注入的秘密由格式在采集侧挡在结果文件之外（[Record · 复制与瘦身](../record/library.md#发布publish)）。

## 结果版本与错误

扫描整个记录根时，单个不可读 Run 不会挡住其它结果；每个被跳过的 Run 形成一条`unreadable-run` [Sample Issue](../sample/library.md#issue-code-全集)（含目录与原因），由页内`SampleNotices` 显示。
用 `--run` 明确指定单个 Run 文件时，该文件不可读会让命令失败。

| 场景 | 行为 |
|---|---|
| 非 niceeval JSON | 忽略 |
| schemaVersion 不兼容 | 跳过并建议用产出它的 niceeval 版本打开 |
| JSON 损坏或必需字段错误 | 标为 malformed |
| attempt 已写入但缺 `run.json` | 标为 incomplete |
| 单个 attempt 缺可选 artifact | 页面可打开，在该证据位置显示缺失 |

零可读结果时，本地 server 不启动，`--out` 也不会生成空站。
读取不会迁移或改写历史结果。

## 自定义报告与外壳

```sh
niceeval view --report reports/exam.tsx               # 树形态：报告树替换默认外壳的报告槽
niceeval view --report reports/site.tsx               # 配置对象形态：品牌外壳 + 多页导航
niceeval view --report reports/site.tsx --page exam   # 指定初始页
```

报告文件同时可被 `niceeval show --report` 使用。
官方组件都有 web 和 text 两个渲染面，所以同一张 page 在浏览器和终端保持相同数据口径；view 注入静态详情链接与 dialog 路由，show 注入带完整 `--report` 上下文的 locator 命令。
写法见 [Library](library.md#交给-show-view-渲染)。

报告文件的默认导出恒为 `defineReport` 产物：树形态展开为单张 sample-input page；[配置对象形态](library/shell.md)声明外壳与 pages。
写好的定义填进 `niceeval.config.ts` 的 `report` 字段，不带选项的 `niceeval view` 就默认装载它，团队里不必人人记住 `--report`（[项目默认报告](README.md#项目默认报告)）。
view 只把 `navigation !== false` 的 pages 列进导航；sample-input page 读取 Sample，attempt-input page 按 locator 读取 `AttemptEvidence`。
未声明 attempt-input page 时，view 用内建详情页补位，但不把它加入导航或改写报告定义。
`--page <id>` 未命中或试图在没有 locator 时打开参数化 page，均按完整用户反馈报错。

内建首页的两个渲染面共享同一份实体与读数数据：web 面使用可排序的实验表，text 面使用紧凑列表；两面都直接消费完整 Sample，不设实验组选择器。
端到端通过率、成本、耗时、Tokens、判定构成和证据引用来自同一份计算结果。

## 主题

站点长什么样是一份和报告分开的制品。
`--theme` 换一次外观而不动报告文件，报告自己的 `theme` 外壳字段是它自带的外观，两者与项目配置、内建 [`basalt`](themes/basalt.md) 组成[四档取值链](library/theme.md#装载链)：

```sh
niceeval view --theme ./themes/acme.ts                       # 换成自己的主题
niceeval view --report reports/site.tsx --theme ./themes/acme.ts
niceeval view --theme basalt                                 # 内建主题名，回到官方外观
niceeval view --theme ./themes/acme.ts --out site            # 导出带同一份主题
```

主题同时作用于 view 导航 chrome 与页内报告组件，本地模式和 `--out` 使用同一份静态 CSS。
主题的令牌与它自带的 `styles` 在报告外壳的 `styles` 之前加载，所以报告作者的覆盖压在主题之上。

浅色与深色由主题的 `appearance` 决定：`system` 时初始跟随浏览器 / OS，页头带一个浅 / 深切换控件，读者的选择按站点记在浏览器本地；`light` / `dark` 锁定全站，不渲染控件。
无 JavaScript 时初始 HTML 就是声明的外观，切换控件是增强层，不改变任何数值。

`--theme` 是 web 面的 flag：`niceeval show --theme …` 按完整用户反馈报错并指向 `view`。
不含路径的名称一律查内建主题名表，不回落到文件探测；想装载文件就写成带路径形。
令牌全集、语义边界与 CSS 级联见[主题](library/theme.md)。

## 相关阅读

- [Show](show.md) —— 同一批结果的终端入口。
- [Reports Library](library.md) —— 自定义报告槽；外壳与多页见[分篇](library/shell.md)。
- [Theme](library/theme.md) —— 主题制品、装载链、令牌全集与 CSS 覆盖。
- [Record](../record/README.md) —— view 读取与导出的数据。
- [Architecture](architecture.md) —— 报告宿主与「宿主只剩机器」的边界清单。
