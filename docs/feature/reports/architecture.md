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
  .sample = complete expected-slot framework
  capability = same frozen reader view
          │
          ├─ RecordProjection declarations
          ▼
ProjectedSample（exhaustive logical entries + coverage + Attachment states）
          │
          ├─ Calculation（跨 owner 派生）
          ├─ Page / PageFamily / Download（包装结果）
          ▼
ReportExecution（host-owned、immutable、self-contained）
          ├─ show
          ├─ one fixed view revision
          └─ static export
```

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

这些 callback 的参数缩窄不是 JavaScript security boundary。受信任 module 仍可 import `node:fs` 或读 env。当前契约不提供 untrusted Report 的沙箱。

## Calculation 与分母

Calculation 从完整 Sample 与已声明 ProjectedSample 派生一个值，不依赖另一个 Calculation；共享公式用普通纯函数。

```text
pass rate
observed:    20
denominator: 100
state:       partial
```

`allow-partial` 可以显示 `20 / 100 · partial`，但不能把 20 改写成完整总体。

`sample.denominator` 与 `coverage.sample.denominator` 只是 Sample-wide 的 slot denominator，不因 Attachment 状态改变。它不是所有 Calculation 的业务 denominator。每个 Calculation 的 `observed` 与 `denominator` 都是作者返回的 domain value；host 不从 transport coverage、entry 数或 access count 推导它们。

## Closed semantic tree 与路径

Page 输出闭合的 `ReportDocument` ADT，不是任意 JSON、HTML、React DOM、CSS 或用户 renderer。Web、terminal 与 static 从同一棵树派生；没有平行 `textAlternative`。

精确树形状验证之外，host 验证 number、Unicode、table keys、chart 长度、cycle、深度、nodes、strings 与 route/download links。HTML 按 context escape，terminal 把控制字符转成可见文本；不存在 raw HTML 逃逸口。

Semantic route 与 filesystem path 分开。Route / download constructor 固定 lowercase ASCII grammar；static host 把 author route 映射到 `a/b/index.html`，再从当前页面 output path 计算相对 href。所有 author outputs 与 host files 进入同一 collision set。

## 一次 immutable execution

`executeReport({ sampleHandle, report })` 在 bound sample handle 仍活时完成全部 Attachment I/O 与作者 graph。返回前：

- 全部投影结果与 Calculation 值已形成；
- PageFamily instances、routes、documents 与 downloads 已固定；
- 每个 projection、Calculation、family、page instance 与 download 最多执行一次；
- execution 不再持有 callback 或 resource capability。

`ReportExecution` 不含 Record root、reader、Scope、path 或 projector token。show / view / static export 只消费它。

## Effect 边界与精确 Tags

Record / Analysis / Projection / Report 内部一路返回 Effect。`executeReport` 使用 selection handle 中已有的 frozen capability，R 是 `never`。`showReport` 只要求 `ReportConsole`；static export 只要求 `ReportFileSystem`。Node 热重载是独立 scoped host service，位于 `niceeval/report/host/node`。

Library 不调用 `Effect.runPromise`，也不建立私有 runtime。CLI / application main 只在外层调用一次 `Effect.runPromiseExit`。

## 热重载 = 一系列 fixed executions

```text
watch hint / manual refresh
            │
            ▼
load exact Report / Config / Theme closure（Node host 负责 loader）
select + project + calculate + render once
            │
     ┌──────┴────────┐
     │ failed        │ succeeded
     ▼               ▼
keep last-good   atomically replace
show problem     current revision
```

Node ESM 模块缓存与 watcher 的具体处理是 `niceeval/report/host/node` 的实现责任，本契约只声明行为：

- 每次 rebuild 产生一份新的 fixed `ReportExecution`；
- 完整成功后才替换 current revision 与 watcher closure；
- 失败保留 last-good execution，并显示 bounded rebuild problem；
- 每个 revision 仍是固定的一次 `ReportExecution`。热重载因为变化会创建下一份 execution，而不是让同一份 execution 偷偷重读。

## Static export

Static exporter 只消费一个已完成 execution：

1. preflight execution problems、semantic tree、route、download、limits 与 closure；
2. 在 target 写入 HTML、host-data、downloads、manifest 与 built-in runtime；
3. 逐文件写出后，最后写入零字节 `complete` marker；
4. 返回 receipt。

Recorded-data problems 可导出；任一 execution problem 整体不发布。目标已存在返回 `target-exists`。

中断或失败可能留下没有 marker 的目录。host 以缺失的 `complete` marker 识别 incomplete output，提示用户删除后重试；本契约不承诺原生原子目录发布。

## 不变量

- Record recorded claim、Analysis selection、Attachment projector、Calculation 与 Report host 是不同层。
- effectful data dependency 在读取前闭合；projected value 只能展开纯输出 topology。
- ProjectedSample 穷尽 logical entries；physical optimization 不进入结果语义。
- data problem、execution problem、typed failure、defect 与 interruption 不互相冒充。
- 作者只声明数据与包装结果，不理解 host 编译机械。
- 每个 ReportExecution immutable，所有 declaration / consumer 最多执行一次。
- 热重载发布新 revision，不修改旧 execution。
- web / text / static 从同一 closed semantic tree 与 host-owned problems 派生。
- Sample denominator 不是 Calculation 的业务 denominator；业务口径由 Calculation value 返回。
