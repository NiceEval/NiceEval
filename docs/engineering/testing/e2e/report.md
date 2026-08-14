# 功能域 · Reports 公开读面

本域验证安装后的候选包完成 `exp → show / view / export` Journey。Record 目录是 CLI 产生的
opaque 产品资产；测试不 import Record reader / writer，不扫描物理布局，也不复制 selection、
decoder 或 projection runtime 作为第二套真相。

它由 `e2e/report/` 承担，manifest repo ID 是 `report`。Repo 使用最小真实 Experiment 产生
本轮结果，再只通过 CLI、HTTP、浏览器与 `niceeval/report` 作者 DSL 观察。

## 公开验收计划

### 1. 真实运行与公开选择

- `exp` 完成后取得公开 receipt / locator；测试不把目录项当成功收据。
- 不带 locator 或 `--run` 的 `show` 读取全部 project-current 结果；`show --run` 与精确 Attempt locator 读取具名历史事实。
- 当前身份变化后，旧结果从不带选择项的 `show` 消失，但仍能通过完整 Run ID 读取。
- 未完成、损坏或需要迁移的 Record 只有在 CLI 能稳定制造并返回公开诊断时才自动化；
  物理 marker、envelope、lock 与 family schema 不属于产品 E2E。
- 机器调用方用 `show --json` 读回，不直接打开 `.niceeval/` 文件。

### 2. Report 作者面

- 自定义 Report 从 `niceeval/report` 导入经典组件、aggregation、Calculation、Page / PageFamily、Download 与 Theme。
  同一入口也提供官方 opaque projectors、projection declaration constructors 与必要的纯值类型。
- 经典作者可从 `niceeval/record` type-only 导入闭合的 `Sample` / `AttemptEvidence`；该入口没有 reader、writer 或 path capability。作者不能 import `niceeval/report/host` 或 host/node。
  作者也看不到 reader、root、Scope、Effect、path、raw family/value、owner lookup 或 direct projection runtime。
- `attemptSlotProjection`、`attemptOriginRunProjection` 与 `selectedRunProjection` 保持 Sample
  对齐；PageFamily 只能从已经投影或计算的内存值展开 route。
- `allow-partial` 保留可用结果和具名问题；`require-complete` 形成 data-unavailable。
- 同一个 projection、Calculation、Page instance、PageFamily 与 Download 在一次 execution 中
  最多执行一次；页面返回 closed semantic document。

### 3. show、view 与机器出口

对同一次真实运行执行：

```text
niceeval show --run <runId>
niceeval show
niceeval show @<AttemptLocator>
niceeval show @<AttemptLocator> --json
niceeval view --run <runId>
niceeval view
```

- text、JSON、HTTP 与浏览器使用同一 Report，公开 identity、数值、分母、状态和 issues 一致。
- `show --execution`、`--timing` 与 `--source` 只显示运行时捕获事实，不从当前源码或私有文件补造。
- 普通 selector 的 `--json` 输出 `niceeval.show` 数据信封；显式 `--run` 且没有 `--report` 时输出
  `niceeval.report-show/v1` membership envelope。公开 `--report` 与 `--json` 互斥。
- view 的成功 rebuild 原子替换 last-good；Config / Report / Theme load 失败保留 last-good 并显示有界问题。
- HTTP request、页面打开与刷新不触发新的作者数据请求；view 默认只绑定 loopback。

### 4. Static export

- `view --out` 从同一公开选择导出自包含目录；目标已存在时失败且不替换既有目录。
- 断网、禁 JavaScript时仍能读取核心文字、数值、状态、表格、互链与下载。
- 浏览器不需要源 Record、网络或 NiceEval 安装；导出结果不泄漏 Record path 或内部文件布局。
- execution problem 不发布静态站；recorded-data problem 可以发布，但必须在 problems surface 可见。

## 验收边界

- 测试断言用户拿到的公开结果，不断言内部文件名、bytes、schema registry、lock 或 reader 类型。
- feature 文档声明目标契约；实现任务负责交付，测试不能用手写 fixture 伪造为已完成。
- 模型输出质量不做确定性断言；只断言可重复的身份、状态、字段、route 与 host 一致性。
- 渲染颜色、像素与私有 class 不属于契约；可访问文字、语义结构、离线路由和下载属于契约。
- 测试正文保留业务文案、实体身份、输入与 expected。`test/support/` 只能拥有无业务知识的几何检查、进程或浏览器生命周期、等待、artifact 与 cleanup。
- 不使用 computed style、像素阈值、golden、私有 selector 或业务 BrowserReport assertion DSL。桌面和移动端截图只作为人工验收 artifact，不是自动化 oracle。

## Oracle 与 kill receipt

每个既有 owner 的断言只读取用户可观察的 HTTP、href、可访问名称、ARIA 状态、文字、表格或下载结果。测试不能从候选包的 DOM 结构、内部 host data、Record 文件或 renderer 输出反推 expected。

任何实质修改的 Report E2E case 都要保留 kill receipt。receipt 指向 fix parent 或最小逆补丁，写明真实公开动作、
第一个失败的 prepare / invoke / observe / outcome / cleanup 阶段与失败断言。候选必须通过同一断言；没有能杀死旧实现的 receipt，不把 case 叫作回归保护。

## E2E owner anchors

### report-project-current

`report-project-current.test.ts` 验证不带选择项的 `show` 累积全部身份仍匹配的 Run。Eval source 改变后，旧结果从当前 Sample 消失，但具名 `show --run` 仍返回对应 membership Report；下一次 `exp` 产生匹配的新结果。验收只走公开 receipt / show，并确认 `--latest` 已移除。

### report-config-reload

`report-config-reload.test.ts` 验证 Config、Report 与 Theme 的受控热重载；自定义 Theme 从 `niceeval/report` 导入。

### report-execution-evidence

`report-execution.test.ts` 通过 `show --execution` 与 `show --timing` 验证已停稳执行证据。

execution JSON 必须保留 identity、Evaluation coordinate、assistant / tool-call conversation、commands、
usage、timing、diagnostics 与每项证据状态。`--grep` 不能裁剪机器证据。

`--timing` 人读面只公开阶段身份或明确不可用。`--timing --json` 必须是 `niceeval.show` 且
`view` 为 `timing`。`data` 必须带 `kind`、attempt `locator`、`durationMs` 和 `phases` 数组。
`durationMs` 是数值或 null，不能补 0。具名阶段必须出现，或 JSON 带明确 unavailable 状态；不能退化成
缺 `view` 或 `data: { locator }`。人读面与 JSON 的 unavailable / 具名阶段必须一致，不断言具体耗时数值。

### report-static-export

`report-export.test.ts` 验证 `view --out` 的自包含交付结果与已存在目标保护。

### report-show-json

`report-show.test.ts` 验证 locator、project-current、human 与 JSON 公开读回。不带选项的 `show` 在项目
未配置 Report 时使用 `standard`；`--report` 与 `--json` 互斥。

`show --json --page` 在 Record I/O 前失败；JSON 数据 view 不静默接受或忽略 Report page selector。

普通 pipe 保持无框纯文本。真实 PTY 在固定终端尺寸形成闭合、等宽且包含经典 summary 与
Experiment table 的框；几何 parser 不拥有业务文案。

Attempt JSON 必须公开 Calculation 状态、canonical identity、Evaluation、Assertions、Verdict 与 Score。
它还要保留 conversation、commands、usage、timing 与 diagnostics 的证据状态，不能退化成 `{ locator }`。

### report-source-snapshot

`report-source.test.ts` 验证 `show --source` 使用运行时快照，不读取后来修改的工作树内容。text / JSON 保留 canonical locator，且不输出 `@unknown`、Record path、`sources.json` 或 `artifactPath`。

### report-browser-journey

`report.browser.spec.ts` 从真实候选包执行 `exp → view --out → niceeval view → browser`。

经典 Report 的 oracle 是 package chrome、Hero、主读数、图表可访问表、Experiment hierarchy、筛选、
原生 disclosure、同 URL 详情 dialog、焦点恢复和双语切换。自定义 Report 验证真实 HTTP、普通 href、
详情导航与热重载。

自定义 Report 还用安装后的公开作者 API 形成一个页面：`niceeval/record` 的 type-only Sample、
classic `defineReport`、package JSX runtime、`aggregate` 与经典组件。这个页面与低层 Page / PageFamily
共用同一 execution 和 host。

作者页按真实下游的组合方式定义自有 `defineComponent`，从 `ctx.scope` 聚合 Bars，并同时渲染
`ExperimentScatter` 与 `ExperimentTable`。owner 因此守护组件导出、上下文和层级导航，不只守护 TSX loader。

禁 JavaScript 的 `file:` 页面必须保留 static export 的内容、表格与原生 disclosure。移动 viewport 的
文档不能横向溢出。owner 不依赖私有 selector、computed style、像素或 golden。
