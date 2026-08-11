# 功能域 · Record 与 Reports 读面

本域验证一次真实运行写出的 current Record，能否经 analysis selection、typed RecordAttachment projector 与 Calculation 形成 closed semantic report tree。`show`、热重载 `view` 与 static export 必须给出一致的公开结果。

它由 `e2e/report/` 功能 Repo 承担，manifest repo ID 是 `report`。适配器仓库不复制格式知识，读取只走公开 Record 与 Reports API。仓库使用一个最小真实 Experiment；所有验收组复用同一次真实运行，不因断言数量增加模型成本。

## 验收计划

### 1. Record 提交

真实运行形成 Pass Eval 与 Score Eval Attempt，并逐项验证：

- root bootstrap 精确声明 current `RecordFormatId` 与 canonical `recordId`；
- Run、Member 与 Attempt 只有稳定 Core；每个 owner-local `RecordAttachment` 独立保存 `attachment.json`、`payload.json` 与可选 `blobs/**`；
- 每个 Attempt 都有 terminal Verdict；Score Eval 另外有 score，evaluation manifest 使用 `evaluationKind: "pass" | "score"`；
- Assertions、diagnostics、usage、diff、trace 等业务事实只出现在所属 RecordAttachment；
- exact JSON RecordAttachment 与 owner-local blob closure 的 media type、collection、路径与数量符合 Record contract；
- writer 直接写入 `runs/<RunId>/`，flush 后最后 exclusive create 零字节 `complete`；完成标识前目录不是 Run，完成后整个 Run immutable；
- 外部损坏一个 RecordAttachment 文件后，下一次 reader 只把该 Attachment 报为 `invalid`，Core 与其它独立 Attachment 仍可读；
- 第二个 writer 得到 `record-writer-busy`；reader 与 writer 可并发且只可能漏掉刚完成发布的 Run，不能看见半个 Run。

### 2. 公开读取与 AnalysisSample

`openRecordReader({ root })` 只打开 current major 并导航 Core。验收：

- known old major 返回 `record-migration-required`（携带 source、target 与 `niceeval migrate` 命令）；future 或 foreign 返回 `record-format-unsupported`。不会 compat read 或自动 migrate；
- explicit 与 latest analysis selection 都只选择 complete published Runs；
- `AnalysisSelectionHandle.sample` 保留 selected Runs 与全部 expected slots；handle 保留同一 frozen reader capability，pure Sample 关闭 reader 后不能重新获得 I/O；
- latest candidate 的分组 identity 无法可靠读取时返回 `sample-latest-indeterminate`，不跳过损坏 Run 猜较旧结果；
- Core entry 损坏形成 `RecordCoreRead.core-invalid`；权限、I/O、closed Scope 保留为 Effect typed error；
- requested RecordAttachment 的 `unavailable`、`migration-required`、`migration-unavailable`、`unsupported`、`invalid` 与 collection partial 可区分。未请求 Attachment 不读取也不污染 Sample。

### 3. Report 声明、动态页面与执行

自定义 Report 使用 document、blob-backed 与第三方 typed Attachment projector。验收：

- 作者只使用 `attemptSlotProjection`、`attemptOriginRunProjection` 与 `selectedRunProjection` 声明数据。包装结果只用 `reportInputs`、`defineCalculation`、`definePage`、`definePageFamily`、`defineDownload` 与 `defineReport`；
- 作者 callback 不接收 RecordReader、root、Scope、Effect、path、owner lookup、compiled plan 或 route-expansion handle；
- 宿主从 Report + bound selection 在任何 Attachment I/O 前穷尽全部 `RecordProjection` declarations；
- 同一 projection declaration 只 decode/project 一次；logical entries 只引用唯一 result/problem table，不存在公共 projector ID registry；
- PageFamily 可以从 Assertions、conversation turns/tool calls 与 diagnostics categories 展开 exact routes，但不能新增 I/O。缺少 durable item key 时只能保留列表页与问题，不能用数组下标伪造稳定 route；
- `allow-partial` 可以继续成功 entries；`require-complete` 形成 data-unavailable。Projector/consumer throw 是 execution problem，不能伪装成 Record invalid；
- 每个 Calculation、Page instance、PageFamily 与 Download 至多执行一次；PageFamily 产生零 instance 也保留 family result；
- host-owned problems surface 不可由作者过滤；interruption 保持 Effect Cause；
- 页面返回 exact `niceeval.report-document/v1` closed semantic tree；table/chart/link relational validation 通过，web、text 与 static HTML 从同一树派生；
- 普通 named interface 完成 projector 与 Calculation 推断；wrong owner/value/access 在真实 TypeScript + `effect@3.22.1` fixture 中不能编译。

### 4. CLI、热重载与机器出口

对同一份真实 Record 执行：

```text
niceeval show --run <runId>
niceeval show --latest
niceeval show --run <runId> --page /attempts/attempt-<attemptId>
niceeval view --run <runId>
niceeval view --latest
niceeval view --run <runId> --out <new-directory>
```

验收：

- show、一个 view revision 与 `--out` 使用同一 selection、inputs、Calculation 与 semantic tree；
- text、web 与 JSON 的公共数值、分母、状态和 issues 一致；
- requested RecordAttachment 状态在各 host 一致；未请求 Attachment 不读取、不出站；
- 本机 view 观察 Record、Report 静态 import closure、Theme 与 Config。每次 rebuild 产生一份新的 fixed `ReportExecution`：完整成功后才替换 current revision 并清除 lastProblem；失败保留 last-good execution 并显示 bounded rebuild problem；
- recorded data problem 或已隔离的 author/projector/tree/route execution problem 仍发布成功 revision，并显示 built-in problems。module/Config/Theme load、Record/selection 全局 typed error 或 limit 才保留 last-good；
- HTTP request、页面打开与刷新不触发新的 Record I/O；watch 输入闭集是 Record root、Report / Theme module 及其项目内静态 import 与 `niceeval.config.ts`；
- view 默认只绑定 loopback；
- `show --json` 输出 exact `niceeval.report-show/v1`：sample 摘要、projection coverage、Calculation results、family summaries、pages、download metadata 与 problem table。它不输出 Download raw bytes。

### 5. Static export

`view --out` 用真实浏览器验收：

- 全部 PageFamily instances、author routes、downloads、semantic trees 与 asset paths 在创建正式目标前穷尽验证；任一 execution problem 整体不发布；
- recorded data problems 成功导出并在 host-owned problems page 显示；
- 目标已存在返回 `report-export-target-exists`，不删除或替换既有内容；
- 全部文件写出后最后写入零字节 `complete` marker 再 sync；中断或失败可能留下没有 marker 的目录，host 提示删除后重试；本契约不承诺原子目录发布；
- 页面在断网、禁 JavaScript 条件下仍可读完整数值、分母、状态、表格、嵌套互链、download 与 problems page；
- 浏览器不需要源 Record、网络或 NiceEval 安装；
- manifest 穷尽所有文件，不暴露 Record path、RecordAttachment path 或 blob path。

## 验收边界

- 自动化只证明稳定、公开、可观察的边界；不复制 Record reader、decoder、analysis selection、projection 或 Calculation 作为第二套真相。
- 模型输出质量不做确定性断言，只断言文件集合、状态、字段形状、分母、routes 与 host 一致性。
- Feature docs 是目标契约。实现尚未到达时保留目标 owner；不能把 owner 降格回旧 Results、Graph、compat reader 或任意 JSON page model。
- 渲染颜色、像素与私有 class 不属于契约；可访问文字、语义结构、离线路由和下载结果属于契约。

## E2E owner anchors

### report-project-current

`report-project-current.test.ts` 验证项目输入未变时复用 current Record；Eval source 改变后，`show` 排除旧结果，并由下一次 `exp` 重建结果。

### report-config-reload

`report-config-reload.test.ts` 验证运行中的 view 重新加载 Report 静态 import closure、Theme、Config 与 Record。成功 rebuild 原子替换 current revision；失败保留 last-good 并显示 bounded rebuild problem。

### report-execution-evidence

`report-execution.test.ts` 验证 `show --execution` 从本轮 Record 读回确定性的 conversation 与 tool-call evidence（Attempt-owned RecordAttachment），不读取修改后的工作树。

### report-static-export

`report-export.test.ts` 验证 `view --out` 从一个 immutable execution 导出可读、自包含且以 `complete` marker 收尾的静态站。

### report-show-json

`report-show.test.ts` 验证 `show --json` 输出 exact `niceeval.report-show/v1`，与 text/静态站共享同一 semantic tree、状态、分母和 problem table。

### report-source-snapshot

`report-source.test.ts` 验证 source 详情沿 Attempt 的 exact origin reference 读取 recorded source snapshot（Run-owned `niceeval.sources/v1`），不读取修改后的工作树。

### report-browser-journey

`report.browser.spec.ts` 验证自定义 Report 从真实运行、本机热重载 view 到 static export 的浏览器 Journey。
