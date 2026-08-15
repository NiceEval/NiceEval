# Reports 架构

Reports 把一份 reader-bound analysis selection 和一个 `Report` 执行成 immutable、self-contained `ReportExecution`。它可以计算通过率、展开 Assertion / conversation 详情页并交给 terminal、Node view 或 static exporter；它不拥有 Record、reuse planning 或评估事实。

## 唯一分层

```text
portable Record
  Core + independent immutable RecordAttachment
          │
          ├─ analysis selection（只读 Core）
          ▼
AnalysisSampleHandle
  .sample = selection-established expected-slot framework
  capability = same frozen reader view
          │
          ├─ classic facade：固定 projection plan
          │   （evaluation plan / verdict / kind-gated score / usage / timing）
          ├─ RecordProjection declarations（低层 API）
          ▼
ProjectedSample（exhaustive logical entries + coverage + Attachment states）
          │
          ├─ 深冻结 Sample + page.render(sample) 展开受控 JSX
          ├─ Calculation（跨 owner 派生）
          ├─ Page / PageFamily / Download（包装结果）
          ▼
closed semantic validation
          ▼
ReportExecution（host-owned、immutable、self-contained、单一 locale）
          ├─ show（英语）
          └─ ViewRevisionClosure（host-private、英语 + 简体中文 execution）
              ├─ one fixed view revision
              └─ static export
```

classic facade 与低层 projection API 是同一个管线的两个作者入口。facade 声明固定 projection plan，host 只投影一次，构造深冻结 `Sample`，再经同一条 fixed-page callback 调用 `page.render(sample)`。
展开结果与低层页面的输出汇入同一个 closed semantic validation 与 `ReportExecution`。`classic-dashboard` 只是 presentation profile，不存在第二套数据面或渲染面。

## 本地化 execution 与 view revision

每份 `ReportExecution` 只对应一个 locale。它保存已经选择该 locale 的正文、导航标题与 package 文案，
以及当前 Report 的业务数值、状态、层级与 route；它不保存另一语言的正文，也不保存浏览器专用的数据模型。
CLI 的文字面使用英语 execution。

browser host 私有的 `ViewRevisionClosure` 绑定同一份 frozen selection、Report、Config 与 Theme
closure。它在这组输入上分别生成 `en` 与 `zh-CN` 的 `ReportExecution`，并在发布前验证二者同构。
host 不把这个 closure、locale 配对或构造过程暴露给 Report 作者。

同构验证检查 fixed page 与 PageFamily route 集、导航顺序和可见性、semantic node 形状、层级 row identity、
实体 target、数值、coverage、状态与 problems。只有 `LocalizedText` 和 package-owned 文案可以随 locale
变化。任何缺页、route 冲突、业务载荷差异或 callback 失败都使本次 rebuild 失败。

`ReportDocument.metadataOrigin` 与 Hero 的 `lastRunAt`、`runCount` 都是业务载荷。closure 要求三者的
存在性和值完全一致；它们不是 locale 文案。

host 只在两份 execution 完成并通过验证后，原子替换 current revision。失败时 current revision 保持
last-good，页面只增加有界的 rebuild problem；host 不发布单语言、半完成或混合 revision。

HTTP request、页面刷新、语言切换、tab、dialog、disclosure 与表格筛选都只读取当前
`ViewRevisionClosure`。它们不执行作者 callback，不读取 Record，也不重新计算 Sample、projection、Calculation
或页面 topology。Record I/O 与作者 callback 只发生在 revision build。

静态导出消费同一份已经闭合的 `ViewRevisionClosure`。每条 ordinary canonical route 只有一份英语 HTML，
所以禁用 JavaScript 仍有完整页面、层级和详情 href。内建渐进增强可以在原页面切换到 closure 中的简体中文文本，
但不得新建 locale route、复制 canonical 页面或请求新的业务数据。

浏览器 host 可以采用 0.12 的 chrome、CSS 与机械渐进增强。它不得引入 React `ViewData`、旧
`Record/data.ts` 或旧 renderer，因为这些路径会形成平行的数据或业务渲染面。

这条链包含三种不同派生：

- analysis selection 选择 Run，并建立 Sample-wide slot denominator；它不叫 projector；
- `RecordAttachmentProjector` 只把一个 owner 的一份 Attachment payload 形成 typed view；
- Calculation 跨 owner / Attachment 聚合通过率、成本或诊断分布。

Execution 的 reuse / gap 判定属于 Experiments reuse planning，也不叫 projector。只有 single-owner / single-Attachment 的 typed adapter 保留 projector 这个术语。

## 静态数据依赖，动态页面 topology

Report 作者可以按 Assertion、conversation turn、tool call 或 diagnostics category 生成动态页面。这些 item identity 只存在于 Attachment value，不能为了页面方便膨胀 Record Core。

Host 内部执行两段，但不把阶段类型暴露给作者：

1. 从 `Report` 收集有限 `RecordProjection` 集合，在任何 Record I/O 前闭合全部 effectful dependencies；
2. projection 与 Calculation 完成后，PageFamily 从已有内存值展开 instances、routes 与 documents。

第二段不能返回新的 `RecordProjection`、请求 owner / Attachment、读 reader 或触发 I/O。它只改变输出 topology。

| 场景 | 静态数据声明 | 内存展开依据 |
|---|---|---|
| 每个 Assertion 详情页 | attempt-slot Assertions projection | Assertions Attachment 的 durable `entryId` |
| 每个 turn / tool-call 详情页 | attempt-slot conversation projection | turn / tool durable key |
| diagnostics 分类页 | diagnostics projection + registered Calculation | normalized category key |

没有 durable item key 时只能生成列表页；数组下标不能冒充稳定 route identity。

## 穷尽 logical entries 与一次 projection

`attemptSlotProjection` 与 `attemptOriginRunProjection` 对 Sample 每个 slot 都形成一条 logical entry；excluded、not-recorded 与 core-invalid 不消失。`selectedRunProjection` 对每个 selected Run 一条。相同物理 owner 被十个 slot 引用仍有十条公开 entries。

Host 按 projection declaration identity 执行并缓存至多一次。Projector callback defect 在 unique 执行边界只形成一次 execution problem，再让所有引用它的 consumer 引用同一个 problem ID。Physical read/cache count 不进入 `ProjectionCoverage` 或 `ReportExecution` 语义。Coverage 分开统计：

- Sample slot framework 与 slot states；
- logical access count；
- 按 logical entries 统计的 Attachment result states。

Package-owned projection 可以声明另一个同计划 projection 作为静态 requiredness dependency，并为每条 logical entry 给出 required、not-applicable 或 unresolved。Host 只理解这三种中立状态，不理解 Evaluation kind 或 Attachment key。Raw `ProjectionCoverage` 仍描述物理投影结果；completeness 与 problems surface 再应用 requiredness。只有 dependency 明确证明不适用时才忽略缺失数据，dependency 缺失、损坏或无法匹配 Slot 都保持 unresolved。

通过率等业务读数必须由 Calculation value 自己定义 `observed` 与 `denominator`，host 不从 coverage、entry 数或 access count 推导。

## Completeness 与局部隔离

not-recorded、core-invalid、excluded 是 slot states。unavailable、migration-required、migration-unavailable、unsupported、invalid 是 Attachment data states。projector / Calculation / 组件 callback throw 是 execution problem。interruption 是 Effect Cause。四者不能互相改名。

直接消费 projection 的组件显式选择：

- `require-complete`：required data 不完整时不调用 callback，形成 data-unavailable result；
- `allow-partial`：callback 收到穷尽 ProjectedSample、coverage 与 issues，可以继续包装成功 entries。

Projection execution failure 不是 partial data。Calculation 不执行；Page/PageFamily 可以在 host 的逐 consumer 隔离后显示其它成功 entries，但 execution problem 仍存在。Static export 对任何 execution problem fail closed。

Host 在作者 callback 之前汇总 recorded-data problems，并在 callback 边界追加 execution problems。`ReportExecution.problemTable`、family-level results 与所有 built-in problems surface 不可关闭。作者过滤 entries、返回零 instance 或省略 problem node 都不能让问题消失。

因此：

- recorded-data problem 允许成功 show、view 与 static export，且必须显式呈现；
- 未请求的坏 Attachment 不读取、不影响 execution；
- callback defect、非法 semantic tree 或 route conflict 允许 show/view 保留其它页面，但 static 整体不发布；
- Record read、permission、closed selection 与全局 limit 留在 Effect typed error；
- interruption 始终传播并触发 finalizer。

## 作者 API 与 host 编译机械

作者只拿到：

- `Report` / `defineReport`；
- `RecordProjection` factory；
- `defineCalculation`、`definePage`、`definePageFamily`、`defineDownload`；
- route / instance-key 构造器；
- closed semantic document builders。

作者看不到 reader、root、Scope、Effect、owner lookup、compiled plan、route-expansion receipt 或 staging。`ReportDefinition`、`ReportPlan`、`ReportInput`、binding、matrix、prepare、materialize 都不进入 public API、作者签名、教程或 Concepts。

这些 callback 的参数缩窄不是 JavaScript security boundary。受信任 module 仍可 import `node:fs` 或读 env。当前契约不提供 untrusted Report 的沙箱。NiceEval 只保证 classic 组件拿不到 reader、Effect、Record root / path 与 append-I/O capability。

## Classic facade 数据面

facade 的固定 projection plan 声明 evaluation plan、verdict、kind-gated score、usage 与 timing 五条官方投影。Score 对 Pass Eval 为 not-applicable；对 Score Eval 为 required。host 对 Sample 投影一次，构造深冻结 `Sample`，再调用 `page.render(sample)` 展开受控 JSX 树。

展开结果是树而不是数据访问：`render(sample)` 的时间在 projection 之后，I/O 已经闭合。`aggregate` 从这份已投影值分组，不再请求新的 Attachment。组件树与低层页面的输出进入同一个 closed validation，形成单 locale `ReportExecution`；show 消费英语 execution，live view 与 static export 消费同一份 `ViewRevisionClosure`。公开 `show --json` 与 `--report` 互斥；显式 `--run` 的默认 membership Report、live host 与 static export 使用 `niceeval.report-show/v1`。

### selection-origin

`Sample` 的 metadata 携带 `metadataOrigin` 标注出处，host 不读取当前项目声明来填充历史数据：

- project-current 使用完整 current-declaration profile，metadata 完整并显示 `metadataOrigin: "current-declaration"`；
- explicit-runs（`--run`）在 Record 没有 durable profile 时，metadata 是 unknown / partial，experiment id 回退为 id / unknown，并给出一条结构化 notice；
- 两条路径都不与当前项目字段混合。

durable profile attachment 属于 future 边界。本契约不新增它，也不改 Record。

## Calculation 与分母

Calculation 从完整 Sample 与已声明 ProjectedSample 派生一个值，不依赖另一个 Calculation；共享公式用普通纯函数。

```text
pass rate
observed:    20
denominator: 100
state:       partial
```

`allow-partial` 可以显示 `20 / 100 · partial`，但不能把 20 改写成完整总体。

facade 的 `passRate` 是严格两级分母。第一级在每个 (experiment, eval) 单元内对 attempts 取均值，passed = 1、failed / errored = 0；skipped / missing 不进入分子，也不伪造值，coverage 显式显示缺口。第二级把单元级值跨 Eval 等权平均，得到分组行与总值；行与总值都携带 observed / denominator / coverage。

`sample.denominator` 与 `coverage.sample.denominator` 只是 Sample-wide 的 slot denominator，不因 Attachment 状态改变。它不是所有 Calculation 的业务 denominator。每个 Calculation 的 `observed` 与 `denominator` 都是作者返回的 domain value；host 不从 transport coverage、entry 数或 access count 推导它们。

## Closed semantic tree 与路径

classic facade 的受控 JSX 与低层页面 API 都汇入闭合的 `ReportDocument` ADT，不是任意 JSON、HTML、React DOM、CSS 或用户 renderer。Web、terminal 与 static 从同一棵树派生；没有平行 `textAlternative`。

树包含 Hero、summary、`ranked-bars`、scatter 与 `tree-table` 节点。`tree-table` 表达 Experiment → Eval → Attempt 层级；Attempt 行保留公开 locator target，由 host 按呈现面解释，不声明额外详情页面。

精确树形状验证之外，host 验证 number、Unicode、table keys、chart 长度、ranked-bars / scatter 的 finite 数值、cycle、深度、nodes、strings 与 link target。Hero 外链只接受绝对 https，host 只序列化不 fetch；http、javascript、data、file 与 relative 拒绝。缺失 cost / timing 保持 null，不补 0。HTML 按 context escape，terminal 把控制字符转成可见文本；不存在 raw HTML 逃逸口。

Hero 的 `lastRunAt` 只能是 `null` 或非负 safe Unix-epoch millisecond。`runCount` 只能是非负 safe integer。

inline link 必须属于同一 execution closure。scatter point 与 tree-table row 的合法 route target 是可选实体导航：目标 route 未展开时删除 target 并退化为纯展示；已展开但随后失效时仍沿反向依赖传播失败。

Semantic route 与 filesystem path 分开。Route / download constructor 固定 lowercase ASCII grammar；static host 把 author route 映射到 `a/b/index.html`，再从当前页面 output path 计算相对 href。所有 author outputs 与 host files 进入同一 collision set。

## 一次 immutable execution

`executeReport({ sampleHandle, report })` 在 bound sample handle 仍活时完成全部 Attachment I/O 与作者 graph。返回前：

- 全部投影结果与 Calculation 值已形成；
- PageFamily instances、routes、documents 与 downloads 已固定；
- 每个 projection、Calculation、family、page instance 与 download 最多执行一次；
- execution 不再持有 callback 或 resource capability。

`ReportExecution` 不含 Record root、reader、Scope、path 或 projector token。show 只消费一个 execution；view 与 static export 只消费已经验证的 `ViewRevisionClosure`，不在请求或浏览器操作期间重建 execution。

## Effect 边界与精确 Tags

Record / Analysis / Projection / Report host 内部一路返回 Effect。内部 `executeReport` 使用 selection handle 中已有的 frozen capability，R 是 `never`。`showReport` 只要求 `ReportConsole`；static export 只要求 `ReportFileSystem`。Node 热重载是内部 scoped host service，不形成公开 package 子路径。

Library 不调用 `Effect.runPromise`，也不建立私有 runtime。CLI / application main 只在外层调用一次 `Effect.runPromiseExit`。

## 热重载 = 一系列固定 revision closure

```text
watch hint / manual refresh
            │
            ▼
load exact Report / Config / Theme closure（Node host 负责 loader）
select + project + calculate + render `en` / `zh-CN`
validate both executions are isomorphic
            │
     ┌──────┴────────┐
     │ failed        │ succeeded
     ▼               ▼
keep last-good   atomically replace
show problem     current revision
```

Node ESM 模块缓存与 watcher 的具体处理是内部 Node host 的实现责任，本契约只声明行为：

- 每次 rebuild 为同一份 frozen inputs 生成一组新的 locale execution；
- 两份 execution 完整成功且同构后，才替换 current revision 与 watcher closure；
- 失败保留 last-good revision，并显示 bounded rebuild problem；
- 每个 revision 的每份 execution 都固定。热重载创建下一组 execution，不让已经发布的 execution 偷偷重读。

## Static export

Static exporter 只消费一个已完成的 `ViewRevisionClosure`：

1. preflight execution problems、semantic tree、route、download、limits 与 closure；
2. 为每条 ordinary canonical route 写一份英语 HTML、host-data、downloads、manifest 与 built-in runtime；
3. 逐文件写出后，最后写入零字节 `complete` marker；
4. 返回 receipt。

英语 HTML 是禁用 JavaScript 时的完整页面。runtime 只从 closure 中选择简体中文文本；它不创建 locale route，不复制 canonical 页面，也不读取 Record。Recorded-data problems 可导出；任一 execution problem 整体不发布。目标已存在返回 `target-exists`。

中断或失败可能留下没有 marker 的目录。host 以缺失的 `complete` marker 识别 incomplete output，提示用户删除后重试；本契约不承诺原生原子目录发布。

## 不变量

- Record recorded claim、Analysis selection、Attachment projector、Calculation 与 Report host 是不同层。
- effectful data dependency 在读取前闭合；projected value 只能展开纯输出 topology。
- ProjectedSample 穷尽 logical entries；physical optimization 不进入结果语义。
- data problem、execution problem、typed failure、defect 与 interruption 不互相冒充。
- 作者只声明数据与包装结果，不理解 host 编译机械。
- classic facade 与低层 API 汇入同一个 closed validation 与 `ReportExecution`；不存在第二套数据或渲染真相。
- `Sample` 深冻结且 metadata 携带 `metadataOrigin` 标注出处；history 数据不与当前项目字段混合。
- Hero 外链只接受绝对 https，host 只序列化不 fetch；缺失 cost / timing 不补 0。
- 每个 ReportExecution immutable，所有 declaration / consumer 最多执行一次。
- `ViewRevisionClosure` 只在 `en` 与 `zh-CN` execution 同构时发布；失败不修改旧 revision。
- HTTP request 与 package-owned interaction 只读取 current closure，不执行 callback 或 Record I/O。
- web / text / static 从同一 closed semantic tree 与 host-owned problems 派生。
- Sample denominator 不是 Calculation 的业务 denominator；业务口径由 Calculation value 返回。
