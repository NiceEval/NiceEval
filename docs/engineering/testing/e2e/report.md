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

## E2E owner anchors

### report-project-current

`report-project-current.test.ts` 验证不带选择项的 `show` 累积全部身份仍匹配的 Run。Eval source 改变后，旧结果从当前 Sample 消失；下一次 `exp` 产生匹配的新结果。验收只走公开 receipt / show，并确认 `--latest` 已移除。

### report-config-reload

`report-config-reload.test.ts` 验证 Config、Report 与 Theme 的受控热重载；自定义 Theme 从 `niceeval/report` 导入。

### report-execution-evidence

`report-execution.test.ts` 通过 `show --execution` 与 `show --timing` 验证已停稳执行证据。

### report-static-export

`report-export.test.ts` 验证 `view --out` 的自包含交付结果与已存在目标保护。

### report-show-json

`report-show.test.ts` 验证 locator、project-current、human 与 JSON 公开读回。

### report-source-snapshot

`report-source.test.ts` 验证 `show --source` 使用运行时快照，不读取后来修改的工作树内容。

### report-browser-journey

`report.browser.spec.ts` 通过真实 href、HTTP、可访问身份与可见内容验证浏览器 Journey。
