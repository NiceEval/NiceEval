# Reports 架构

Reports 把一份 reader-bound analysis selection 和一个 `Report` 执行成 immutable、self-contained `ReportExecution`。它可以计算通过率、展开 Assertion / conversation 详情页并交给 terminal、Node view 或 static exporter；它不拥有 Record、reuse planning 或评估事实。

## 唯一分层

```text
portable Record
  Core + independent immutable Channel claims
          │
          ├─ analysis selection（只读 Core）
          ▼
AnalysisSampleHandle
  .sample = complete expected-slot denominator
  capability = same frozen reader view
          │
          ├─ RecordProjection declarations
          ▼
ProjectedSample（logical entries + coverage + Channel states）
          │
          ├─ Calculation（跨 owner 派生）
          ├─ Page / PageFamily / Download（包装结果）
          ▼
ReportExecution（host-owned、immutable、self-contained）
          │
          ├─ show
          ├─ one immutable view revision
          └─ static export
```

这条链包含三种不同派生：

- analysis selection 选择 Run，并建立 expected-slot 分母；它不叫 projector；
- Channel projector 只把一个 owner 的一个 recorded Channel payload 形成 typed value；
- Calculation 跨 owner / Channel 聚合通过率、成本或诊断分布。

Execution 的 reuse / gap 判定属于 Experiments reuse planning，也不叫 projector。只有 single-owner / single-Channel 的 typed adapter 保留 projector 这个术语。

## Record 只保存当时发布的 recorded claims

Record 不是“只保存绝对原始、绝不能计算得到的数据”。Verdict、score、Eligibility 与 Evaluation manifest 可能由当时运行计算而来，但仍是 producer 在 publish boundary 声明并冻结的 recorded claims。

正确判据是：这份值是否属于当时运行、需要在未来离线复核，并且不能保证从同一 Record 中其它已保存 bytes 无损重建。若是，就由领域 owner 通过 versioned Channel 发布；若只是读取时的选择、typed view、聚合或页面，就是 Analysis / Projection / Report 的内存值。

更换 assertion evaluator、Calculation、route、Theme 或 renderer 不修改 Record。持久语义 shape 改变时发布新 Channel schema；Record owner/reference/publish 公理改变时才发布新 Record major并显式 migrate。

## 静态数据依赖，动态页面 topology

Report 作者可以按 Assertion、conversation turn、tool call 或 diagnostics category 生成动态页面。这些 item identity 可能只存在于 Channel value，不能为了页面方便膨胀 Record Core。

Host 内部执行两段，但不把阶段类型暴露给作者：

1. 从 `Report` 中收集有限 `RecordProjection` 集合，在任何 Record I/O 前闭合全部 effectful dependencies；
2. projection 与 Calculation 完成后，PageFamily 可以从已有内存值展开 instances、routes 与 documents。

第二段不能返回新的 `RecordProjection`、请求 owner / Channel、读 reader、访问 path 或触发 I/O。它只改变输出 topology。

| 场景 | 静态数据声明 | 内存展开依据 |
|---|---|---|
| 每个 Assertion 详情页 | attempt-slot Assertions projection | assertion durable key |
| 每个 turn / tool-call 详情页 | attempt-slot conversation projection | turn / tool durable key |
| diagnostics 分类页 | diagnostics projection + registered Calculation | normalized category key |

没有 durable item key 时只能生成列表页；数组下标不能冒充稳定 route identity。坏 payload 无法恢复未知 item key时，host保留对应 data problem，不猜本应存在的 route。

## 穷尽 logical entries 与一次 projection

`attemptSlotProjection` 和 `attemptOriginRunProjection` 对 Sample 每个 slot 都形成一条 logical entry；excluded、not-recorded 与 core-invalid 不消失。`selectedRunProjection` 对每个 selected Run 一条。相同物理 owner 被十个 slot 引用仍有十条公开 entries。

Host 必须按 `(resolved owner, projector private token)` 执行、output encode并缓存至多一次。Available/invalid等data result与projector defect都在这个cache boundary形成一次；logical entries只引用result/problem ID。Physical read/cache count不进入`ProjectionCoverage`或`ReportExecution`语义。Coverage分开统计：

- Sample slot denominator 与 slot states；
- logical access count；
- 按 logical entries 统计的 Channel result states。

Portable projected-value bytes按unique cached result计一次；logical entry count另有独立limit。通过率必须使用Sample denominator，不能把access count或成功projected count冒充分母。

## Completeness 与局部隔离

not-recorded、core-invalid、excluded、unavailable、unsupported、invalid 与 partial 都是可复核 data states。projector callback/codec、Calculation 或组件 defect 是 execution problem。interruption是 Effect Cause。三者不能互相改名。

直接消费 projection 的组件显式选择：

- `require-complete`：required data 不完整时不调用 callback，形成 data-unavailable result；
- `allow-partial`：callback 收到穷尽 ProjectedSample、coverage 与 issues，可以继续包装成功 entries。

Projection execution failure 不是 partial data。Calculation 不执行；Page/PageFamily 可以在 host 的逐 access隔离后显示其它成功 entries，但 execution problem 仍存在。Static export 对任何 execution problem fail closed。

Host 在作者 callback 之前汇总 recorded-data problems，并在 callback 边界追加 execution problems。`ReportExecution.problems`、family-level results 与所有 host 的 built-in problems surface不可关闭。作者 `flatMap`、过滤 entries 或返回零 instance 都不能让问题消失。

因此：

- recorded-data problem允许成功 show、view 与 static export，且必须显式呈现；
- 未请求的坏 Channel 不读取、不影响 execution；
- callback defect、非法 semantic tree、route conflict或无法闭合 output允许show/view保留其它页面，但static整体不发布；
- permission、真实I/O、closed selection与全局limit留在Effect typed error；
- interruption始终传播并触发finalizer。

## 作者 API 与 host 编译机械

作者只拿到：

- `Report` / `defineReport`；
- `RecordProjection` factory；
- `defineCalculation`、`definePage`、`definePageFamily`、`defineDownload`；
- route / instance-key / download-path 构造器；
- closed semantic document builders。

作者看不到 reader、root、Scope、Effect、owner lookup、private token、compiled input graph、route-expansion receipt、staging或Worker。

这些callback的参数缩窄不是JavaScript security boundary。受信任module仍可import `node:fs`、读env或联网。Effect、Worker与TypeScript只管理组合、cache/lifecycle和类型，不隔离恶意代码。真正执行untrusted Report需要data-only AST或security sandbox，当前契约不声称提供。

## Calculation 与分母

Calculation从完整Sample分母和已声明 ProjectedSample 派生值。它不依赖另一个Calculation；共享公式用普通纯函数。

```text
pass rate
observed:    20
denominator: 100
state:       partial
```

`allow-partial` 可以显示 `20 / 100 · partial`，但不能把20改写成完整总体。Pass rate只使用Pass Eval slots + Verdict；score summary只使用Score Eval slots + score，同时仍从Verdict显示errored/skipped/gate失败。所有origin Attempt都有Verdict，Score Eval另有score；二者不互斥、不能互推。

Projector / Calculation output codec成功形成的author-specific `Value`只活在加载codec的当前进程或revision Worker。最终execution把 Calculation value擦除为host-owned exact portable data；父进程没有author codec，不能假装恢复brand/class/transform result。

## Closed semantic tree 与路径

Page输出`niceeval.report-document/v1` closed ADT，不是任意JSON、HTML、React DOM、CSS或用户renderer。Web、terminal和static从同一棵树派生；没有平行`textAlternative`。

Schema exact decode之外，host验证number、Unicode、table keys、chart长度、cycle、深度、nodes、strings、route/download links及resource limits。HTML按context escape，terminal把控制字符转成可见文本；不存在raw HTML逃逸口。

Semantic route与filesystem path分开。Route / download constructor固定ASCII grammar和Windows最小公分母；static host把author route映射到`a/b/index.html`，再从当前页面output path计算相对href。Host problems使用独立、不可由作者构造的URL/path codec：`/_niceeval/problems/`精确映射`_niceeval/problems/index.html`，不经过author route算法。所有author outputs与host files进入同一collision set。

## 一次 immutable execution

`executeReport({ sampleHandle, report })` 在bound sample handle仍活时完成全部 Channel I/O与作者graph。返回前：

- 所有Stream已消费；
- 所有blob与portable envelope已验证；
- PageFamily instances、routes、documents与downloads已固定；
- 每个projection、Calculation、family、page instance与download最多执行一次；
- execution不再持有callback或resource capability。

`ReportExecution`不含Record root、reader、Scope、path、Stream、projector token或author module。show/view/static只消费它。

## Effect runtime 与精确 Tags

Record/Analysis/Projection/Report内部一路返回Effect。`executeReport`使用selection handle中已有的frozen capability，R是`never`；`executeReportFromRecord`只要求Record read Tags。`showReport`只要求`ReportConsole`；static export只要求`ReportFileSystem`。

不存在让show同时要求server/watcher/filesystem的聚合`ReportHostPlatform`。Node热重载入口单独位于`niceeval/report/host/node`并要求replaceable `NodeReportViewHost`。

Library不调用`Effect.runPromise`，也不建立私有runtime。CLI/application main provide Layers后只调用一次`Effect.runPromiseExit`。Scope管理reader lease、watcher、server、worker、file handles与staging cleanup；Scope不能创造OS no-follow、lock或atomic rename原语。

## 热重载 = 一系列 fixed executions

```text
watch hint / periodic reconcile / manual refresh
                    │
                    ▼
fresh one-shot Worker + fresh module graph
load exact Report / Config / Theme closure
open current Record with Worker-owned NodeRecordLive
select + project + calculate + render once
encode host-owned ReportExecution wire
transfer normalized buffers
terminate candidate Worker and close all resources
                    │
            ┌───────┴────────┐
            │ failed         │ succeeded
            ▼                ▼
keep last-good        short uninterruptible commit
bounded problem       current swap → clear problem → small event
```

Node ESM cache没有invalidate dependency closure的API，因此每个revision使用fresh Worker / module graph。Bundler返回本revision精确static import closure；unbounded dynamic import使load失败。Worker隔离解决module cache/lifecycle，不是security sandbox。

`fs.watch`只当lossy hint；host在hint、rename、overflow、periodic interval与manual refresh后做full stat+digest reconciliation，并提供poll fallback。Watcher set只在成功build后替换；失败时继续观察last-good closure、entry和父目录。

Current revision和last problem存在authoritative Refs；`PubSub.sliding`只广播固定容量的小revisionId/candidateId/summary事件，允许丢中间项。Candidate Worker成功transfer或任何失败后立即关闭，不让timer/handle/side effect跨revision继续。

View默认只绑定loopback。Non-loopback必须由CLI host和explicit allow flag双重授权；Config不能开启。Server验证Host/Origin、默认拒绝CORS，并使用session capability URL；refresh是local session Effect，不是无保护HTTP mutation。

每个revision仍是固定的一次`ReportExecution`。热重载保留，因为变化会创建下一份execution，而不是让同一execution偷偷重读。

## Static export

Static exporter只消费一个已完成execution：

1. preflight problems、semantic tree、route、download、limits与exact closure；
2. 在target同父/同filesystem创建owner-specific staging directory；
3. 以handle-relative no-follow写HTML、host-data、buffers、downloads、manifest与built-in runtime；
4. sync files与staging directory；
5. 使用atomic no-replace directory publish；
6. sync parent后返回receipt。

Recorded-data problems可导出；任一execution problem、path/link/collision/closure/limit问题整体不发布。目标已存在、cross-device或平台无法证明atomic no-replace时fail closed，不fallback到`exists + rename`、copy或replace。

Linux需要`renameat2(RENAME_NOREPLACE)`、macOS需要`renameatx_np/renamex_np(RENAME_EXCL)`。Windows需要能证明same-volume、no-replace与directory atomicity的native move。纯Node `fs.rename`不足；未知filesystem capability返回unsupported。

生成站点断网、禁JavaScript仍可阅读文字、数值、表格、链接、downloads与built-in problems surface。它不访问源Record、网络、调用进程或未来NiceEval。

## 不变量

- Record recorded claim、Analysis selection、Channel projector、Calculation与Report host是不同层。
- effectful data dependency在读取前闭合；projected value只能展开纯输出topology。
- ProjectedSample穷尽logical entries；physical optimization不进入结果语义。
- data problem、execution problem、typed failure、defect与interruption不互相冒充。
- 作者只声明数据与包装结果，不理解host编译机械。
- 每个ReportExecution immutable，所有declaration/consumer最多执行一次。
- 热重载发布新revision，不修改旧execution。
- web/text/static从同一closed semantic tree与host-owned problems派生。
