# `niceeval view` —— 在浏览器读固定结果

`niceeval view` 把一个固定 Sample 的 ReportPlan、ReportData 和不可变页面树呈现为本地网页。
它保留导航、深链、主题、本地重建与静态站交付，但不在浏览器或 web renderer 中重新读取 Record。

## 打开与收窄

```sh
niceeval view
niceeval view security/
niceeval view --exp compare/candidate
niceeval view --run compare/candidate@r17
niceeval view --record ./shared-record
niceeval view --report ./reports/security.tsx
niceeval view --report ./reports/security.tsx --page overview
niceeval view --theme ./themes/acme.ts
niceeval view --no-open
niceeval view --port 4400
```

位置参数是 eval id 前缀；`--exp` 和 `--run` 缩小要生成的固定 Sample selection。
`--record` 选择 Record Store 位置，随后 reader 固定到一个 `RecordGraphRef`。
`--report`、项目默认报告和内建 `standard` 仍按同一条装载链选择 ReportDefinition。

收窄先得到固定 Sample，再运行一次 plan。
视图不按 locator、时间或 provenance 再造第二套成员集合；携带、接受与重命名只在已生成的 membership 中说明 provenance。

## plan/data/render 与深链

每次有效浏览构建按以下顺序执行：

1. 冻结报告 module graph 与参数。
2. 打开固定 `RecordGraphRef`，并 materialize 一份 `sources` 恰含该项的 Sample。
3. 运行一次 `definition.plan({ sample, parameters })`，枚举所有 page instance、Calculation 与 Projector request。
4. executor 生成 immutable ReportData。
5. 每个 page instance render 一次，text 和 web 共用结果树。

普通导航页使用 `#/<page-id>`。
参数化详情页的 URL 对应 Plan 中已有的 page instance；点击或直接打开深链不会启动逐请求的数据阶段，也不能获取未枚举的 Attempt。
无法服务的 target 显示结构化错误，不打开空 dialog，也不临时查询其它 Store。

dialog 仍只是已生成详情页面的摆放方式。
无 JavaScript 时，独立页面内容完整可读；JavaScript 只增加导航、对话框和局部浏览行为。

## 持续重建

本地模式可以观察 Record、报告 module graph、主题和配置。
检测到变化后，它重新冻结输入、重新打开 `RecordGraphRef`、重新 materialize 一份单 source Sample，并生成新的 ReportPlan 与 ReportData。

旧页面不在同一次 render 中漂移到新的 source Graph。
当新计划成功后，server 替换订阅页面的已生成 HTML；外壳或主题资产变化时整页重载。
计划、参数或 evidence closure 验证失败时，server 保留上一份可用页面并显示错误，直到下一次成功构建。

### 重建理由是一个闭集

盯的输入是闭集，逐条对应一种「站点会因此不同」的原因：

| 输入 | 触发重建的事件 |
|---|---|
| 有效根内的 Record | head CAS 到新的 committed `RecordGraphRef` |
| 报告文件与它的整棵 import 图 | 改 `--report` 指向的文件，或改它 import 的**自定义组件**、读数、工具模块；项目配置的 `report` 字段同理 |
| 主题文件与它的 import 图 | 改 `--theme` 指向的主题或它 import 的令牌模块 |
| 项目配置 | `niceeval.config.ts` |

**改组件代码同样重建。**
报告是一棵组件树，自定义 renderer 或普通报告函数写在哪个文件里都算报告的一部分。
监听范围包含报告文件的整棵项目内 import 图，不是只看入口文件。
所以「改一个组件的 web 面 → 存盘 →浏览器里看到新样子」是本地模式的常规写法，与改报告文件本身没有区别。

**闭集之外没有第二条重建理由。**
打开页面、刷新浏览器、切页与切语言都不是重建理由：盘上没变，输出就还是上一次那份，请求直接命中它。
所以这张表不只回答「什么会自动刷新」，它同时是「什么改了会生效」的完整答案——手动刷新不构成绕过闭集的旁路。

不盯的有三类：有效根之外的 Record、依赖目录里的包、临时写入文件。
收窄之外的数据本来就不进站点，为它重建只会让页面无故闪动；`niceeval` 自己的内建组件随包分发，改它属于开发 niceeval，不是用这条命令。

### 变更分两类，失效到不同深度

闭集里的两类变更失效范围不同：

| 变更类别 | 重新装载模块图 | 重跑管线 |
|---|---|---|
| 有效根内的 Record | 否 | 是 |
| 闭集里的模块文件（报告、主题、配置及其 import 图） | 是 | 是 |

模块图一个文件都没变时，重新装载它得到的是同一份定义，代价却是把整棵图连同 `niceeval`自身重新求值一遍。
所以 Record 变更沿用上一次装载出的报告与主题定义，只重跑管线。

这一分流分的是「定义要不要重读」，不是「数要不要重算」——两类变更下管线都从头跑满。

### 重建语义

- **整条管线重跑，没有增量档位。**
  重新打开新的 `RecordGraphRef`、重新 materialize Sample、重新执行计划并重新渲染。
  一个 Attempt 提交会改变 coverage 分母和聚合结果，「只追加一行」会让页面内部使用不同 revision。
- **事件去抖后合成一次重建。**
  一次运行收尾时多个 artifact 连续落盘，合成一次。
  重建期间又来事件，在本次结束后再建一次，不排队堆积。
- **失败不拆站。**
  报告文件写错、配置报错时 server 继续服务上一份可用站点，把结构化错误推给浏览器显示、终端同步打印一次；修好保存后自动恢复。
  `--out` 遇到同样的错误按用法错误非零退出——它没有「上一份」可留。
- **终端确认成功完成。**
  watch 触发的每次重建在静态报告站构建完成并推给页面后，打印一行本机时间，例如 `10:09:29 [niceeval view] 热重载完成`。
  初次启动由 URL 清单表示站点已就绪；重建失败只打印错误，不打印完成行。

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
样式表、脚本与 `head` 标签住在 `<head>` 里，就地替换要重走整套加载顺序，比重载一次更难解释、也更容易留下半套状态。
报告块不同：它是文档里一个可替换的区域，换掉它不动其它任何东西。
走哪一档由 server 按外壳指纹判定，不给作者开关。

就地换内容保住的是**手上的位置**：翻到第 40 个 attempt、开着某条 trace 的 dialog、过滤条里打了字——改一行组件代码不该把这些清零。
报告块内部的展开状态跟着新 HTML 走，内容本身换了，它的展开状态没有可继承的对应物。

两档都保留当前路由（`#/<pageId>` 与 `#/<pageId>/<key>`）。
正在看的参数化页实例在重建后仍在有效根内就停在原处；被收窄之外的新数据不影响页面。

与正在运行的实验的关系由 Record commit 担保，不靠 view 自己防抖。
head 只会指向已经完成 CAS 的 immutable Graph；未收尾 Run 与 Attempt 也以该 revision 中已经提交的完整性状态如实显示。

**没有关掉持续重建的 flag。**
本地模式的存在理由就是盯着看；要一份静止不动的快照，那就是 `--out` 的输出，用浏览器直接打开即可。
浏览器切页、改 locale、展开 dialog 或刷新页面都不会增加 Projector request。
这些行为只消费当前计划已经生成的结果。

## 页面构成

- **导航与品牌位**：只列出 plan 中 `navigation !== false` 的 page instance，并按计划顺序显示。
- **标准概览**：消费固定 Sample 的 coverage、MetricValue、available verification / issues 与 unavailable causes。
- **Attempt 与 Experiment 详情**：消费 plan 中声明的 details Projection，不读取 raw event schema。
- **组件资产**：由已生成的组件树收集；脚本不改变数据或证据资格。
- **主题**：`--theme` 与报告 theme 字段继续决定同一份静态 CSS 和视觉令牌。

组件既不选择 Record 成员，也不把 UI 字段反向映射为 Claim、event 或 object 查询。

## 静态导出

```sh
niceeval view --out site
niceeval view --exp compare/candidate --out site
niceeval view security/ --out site
niceeval view --report ./reports/security.tsx --out site
```

`--out` 通过 `loadReportDefinition()` 冻结同一报告模块图，再由公开的 `exportReport()` 消费这份
FrozenReportDefinition、Sample、固定 source reader 集合、参数和 target。executor 在执行 trace
闭合后生成 finalized `ReportExportPlan`；作者不手写它，也不能在 render 过程中补充证据。

输出是独立的 Report artifact，而不是 Record 副本。
artifact 保存纯 JSON page payload、最终 text / HTML 与内容寻址资产；它不保存含函数的
`ReportNode`。`openReportArtifact()` 无需报告模块和源 Record 即可验证并重开，且不会
重跑 renderer。
典型目录包含：

```text
site/
├── index.html
├── pages/
├── assets/
├── report-plan.json
└── evidence/
    └── <proof-digest>.json
```

`evidence/` 中的分页 `RecordEvidenceProofIndexV1` 收录本次交付消费的 event、object、Claim 与 authenticated absence。每项 proof 都绑定源 `RecordGraphRef`、归档原始 bytes 与 canonical path。
源 Claim、stream GraphNode 和其它源节点不会成为静态站 Store 的活动节点。

导出只复制 Plan 明确消费的 evidence closure。
源 Record 已有、但导出时无法读取、验证或复制的依据使整个导出失败；不能把它显示成 `not-recorded`。
source reader 与 proof closure 失败都显示同一个 artifact-owned
`report-evidence-closure-failed`。
它同时按 `phase` 保留完整 `RecordSourceFailure` 或 `RecordEvidenceProofFailure`；view 不把 typed
cause 压成一段字符串。

## 主题

`--theme` 仍是 web 面选项：

```sh
niceeval view --theme basalt
niceeval view --theme ./themes/acme.ts
niceeval view --theme ./themes/acme.ts --out site
```

主题只改变视觉令牌及其 CSS 变量值。
它不能新增 Data request、改变 Sample membership、重新计算 MetricValue 或替换 verification。

## 错误与边界

- 零成员仍按 coverage 显示；无效参数是 `report-parameters-invalid`，未知 page 或不可达 target 是 `report-target-invalid`。
- unavailable evidence 仍以原始 causes 与 basedOn 呈现，不冒充空白成功，也不合成 verification。
- Report artifact 与 SampleBundle 使用独立 Store；静态站不能被 `openRecord()` 当作 Record 打开。
- `view` 不提供以页面字段、网络回调或客户端交互读取计划外数据的旁路。

## 相关阅读

- [Show](show.md) —— 同一份计划的终端入口。
- [Reports Library](library.md) —— ReportDefinition、参数、target 和 exportReport。
- [Theme](library/theme.md) —— Theme 配置对象、令牌和装载链。
- [Sample](../sample/README.md) —— 固定样本与独立 Sample Bundle。
- [Architecture](architecture.md) —— executor、结果树和 evidence closure。
