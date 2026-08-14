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

- 自定义 Report 只从 `niceeval/report` 导入 Calculation、Page / PageFamily、Download、Theme、
  官方 opaque projectors、projection declaration constructors 与必要的纯值类型。
- 作者不能 import `niceeval/record`、`niceeval/report/host` 或 host/node。
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
- view 的成功 rebuild 只在英语、简体中文 execution 同构时原子替换 last-good；Config / Report / Theme load 失败保留 last-good 并显示有界问题。
- HTTP request、页面打开、刷新、语言切换、筛选、tab、disclosure 与 dialog 不触发新的作者 callback 或 Record I/O；view 省略 `--host` 时只绑定
  `127.0.0.1`，显式 host 才允许网络暴露。既有 browser Journey 验证 wildcard 公布可访问 URL、
  非 loopback 警告、advertised Host 边界与只读 method 边界。

### 4. Static export

- `view --out` 从同一公开选择导出自包含目录；目标已存在时失败且不替换既有目录。
- 每条 ordinary canonical route 只写一份英语 HTML。断网、禁 JavaScript 时仍能读取完整的英语核心文字、数值、状态、表格、互链与下载。
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

`report-config-reload.test.ts` 验证 Config、Report 与 Theme 的受控热重载；自定义 Theme 从 `niceeval/report` 导入。它使用既有真实 view Journey 验证英语和简体中文 execution 同时替换，或同时保留 last-good。任何只替换一个 locale、混合两次 revision，或因 request 重新调用作者 callback 的逆补丁都必须在公开观察处失败。

### report-execution-evidence

`report-execution.test.ts` 通过 `show --execution` 验证已停稳执行证据。

### report-timing

`report-timing.test.ts` 验证 `show --timing` 只公开稳定的阶段身份；阶段耗时可以存在，也可以明确不可用。

### report-static-export

`report-export.test.ts` 验证 `view --out` 的自包含交付结果与已存在目标保护。它验证每个 ordinary route 的英语无 JavaScript 页面完整可读，且语言能力不复制 canonical route。

### report-show-json

`report-show.test.ts` 验证不带选项的 `show` 装载项目默认 Report，
并检查 locator、project-current、human 与 JSON 公开读回。

### report-author-dx

`report-author.test.ts` 在安装候选包的消费仓库中先 typecheck 0.12 classic Report，
再通过真实 `exp → show` 验证同一份作者源码可由生产 CLI 装载。

### report-source-snapshot

`report-source.test.ts` 验证 `show --source` 使用运行时快照，不读取后来修改的工作树内容。

### report-browser-journey

`report.browser.spec.ts` 通过真实 href、HTTP、可访问身份与可见内容验证浏览器 Journey。

### report-classic-browser-journey

`report-classic.browser.spec.ts` 以 0.12 classic Report 走两条公开 Journey：

- static 在 `javaScriptEnabled: false` 的真实浏览器上下文中读取 NiceEval chrome、Hero、metadata、主读数、柱状图、散点和 Experiment Table 的英语文字与数据。Hero 外链与标题保持水平居中；多系列柱状图显示具名图例，标签、柱体和值在桌面与窄屏都同排。用键盘展开具名 Experiment → group/eval → Attempt disclosure，再沿页面自身的 canonical href 打开 exact Attempt 详情。单页 Report 缺少 PageFamily 时只删除链接，不删除报告数据；
- live 从公开 `exp --json` 产生真实数据，再从具名 Eval 层级读取页面公开的 Attempt locator。它验证语言控件切换后 route、实体 identity、数值和层级不变，本地化文字改变；同时验证作者固定 pages 的 tabs、scatter Experiment dialog、层级 Attempt dialog，以及关闭后的焦点、tab 与 disclosure 上下文；
- live 在表格中输入筛选条件，只保留匹配行及祖先；清空后完整 hierarchy 恢复。无匹配项必须显示可访问的空结果；筛选不允许触发新的 execution；
- 桌面和移动端都检查页面没有横向溢出。几何检查可以复用无业务知识的 support 函数；截图只附在 artifact 供人工查看，不参与断言。

断言留在 Journey 正文，使用原生 Playwright role、name、可见结果与公开 ARIA 状态。
没有语言控件、Hero、metadata、读数、图形、表格、disclosure、tab、dialog、筛选结果或 target 时必须硬失败。
不得用 `expect.soft`、条件跳过、computed style、像素阈值、golden、私有 class / selector / DOM 包装，或另建业务 BrowserReport assertion DSL。
Testkit 只负责候选注入、隔离副本、真实 CLI/server 生命周期、等待、artifact 与 cleanup 收据。

### report-terminal-dx

`report-pty.test.ts` 在真实 PTY 中逐字验收 0.12 Section 框线和页面导航；pipe 与 `NO_COLOR`
输出保持无框。动态 locator、Run ID、时间戳与时长只能经具名 transcript seam 变化。
