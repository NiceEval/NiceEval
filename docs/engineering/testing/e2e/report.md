# 功能域 · Record 与 Reports 读面

本域回答一个问题：一次真实运行写出的 `niceeval.record`，能否经具名 analysis projector、冻结 ReportPlan 和一次 ReportExecution，在 `show`、`view` 与静态 export 中给出相同的公开结果。

它由 `e2e/report/` 仓库承担（group `report`）。适配器仓库不复制格式知识，读取只走公开 `RecordReader` 与 Reports 接线。仓库使用一个最小真实 Experiment；所有验收组复用同一次真实运行，不因断言数量增加模型成本。

## 验收计划

### 1. Record 提交

真实运行同时形成 `passed`、`failed` 与 `errored` Verdict 的 Attempt，并逐项验证：

- 根文件精确为 `{ "format": "niceeval.record" }`，Results 1–15 一律拒绝且没有迁移路径。
- Run、Member 与 Attempt 只有稳定核心；Verdict、Assertion、diagnostic、usage、diff、trace 等业务事实只出现在 owner-local channel。
- document、JSONL 和 Attempt-owned blob 的 descriptor、coverage、media type、路径与大小边界符合 [Record Architecture](../../../feature/record/architecture.md)。
- Attempt 核心、channels 与 blobs 通过一次目录发布变为可见；Run 与 Member 更新使用单文件原子替换。
- 停稳后人工修改 channel，下一次 reader 看到修改后的值；没有 hash、proof、revision、历史或防伪错误。
- 同一 Record root 的第二项操作以 `record-root-busy` 失败；不同 root 独立运行，既不协调也不自动合并。

### 2. 公开读取与 AnalysisSample

`openRecordReader(root)` 只导航核心。测试分别以 `explicit-runs/v1` 和 `latest/v1` 构造 core-only `AnalysisSample`，并验证：

- `AnalysisSample` 保留全部 selected Run 和 expected slots；`executed`、`carried`、`accepted` Member 都只引用 Attempt。
- latest 候选无法穷尽时得到 `sample-latest-indeterminate`，不跳过损坏 Run 猜一个较旧结果。
- 核心缺失或损坏通过 `CoreRead.missing` / `CoreRead.invalid` 返回；只有权限或 I/O 故障抛异常。
- 未请求的未知、损坏或不支持 channel 不污染 core、`AnalysisSample` 或无关报告。
- requested channel 的 unavailable、unsupported、invalid、partial 与 complete 状态保持可区分；不能折叠成零、空数组或失败 Verdict。

### 3. Report 规划与执行

自定义报告分别使用 document、JSONL、blob consumer 和自定义 fact parser。验收：

- `plan()` 只接收 core-only ReportScope，并产出冻结 ReportPlan；consumer 回调只收到不含 `recordRoot` 的 branded `ReportSample`。
- composition adapter 只读取计划列出的 owner + requirement；不同 requirement 对象复用同一 id 时在任何读取前失败。不同 requirement 可使用同一个 transport name，并各自独立 parse。
- `buildReportInput` 接收 RecordReader、`AnalysisSample` 与 ReportPlan，只读取并解码计划要求的 transport。`executeReport` 对每个 owner + custom requirement 恰好运行一次 parser，再执行 consumer；全部 Calculation 与页面消费同一份不可变 Fact matrix。
- decoder 只能通过 `readAttemptBlob` 取得 bytes，不能获得路径；generic custom fact parser 没有 blob context。
- execute 返回 CalculationResult 与已经规划的 route；页面、下载项和宿主不能触发第二次 channel 读取或计算。

### 4. CLI 与机器出口

对同一份真实 Record 分别执行：

```text
niceeval show --run <runId>
niceeval show --latest
niceeval show --run <runId> --page attempt-<attemptId>
niceeval view --run <runId>
niceeval view --latest
niceeval view --run <runId> --out <new-directory>
```

验收规则：

- `show`、`view` 与 `--out` 使用同一套 analysis projector、ReportPlan、ReportInput 和 ReportExecution；text、web 与 JSON 的公共值相同。
- `--run` 与 `--latest` 互斥；Attempt detail route 只能引用 `AnalysisSample` 中的完整 identity，越界 route 在装载前失败。
- requested channel 的状态和 issue 在各宿主一致可见；未请求 channel 不读取、不出站。
- 进程启动后 Record 或 Report module 的编辑只影响下一次命令；本机 server 不 watch 输入。
- JUnit consumer 把 `failed` Verdict 写成 `<failure>`、把 `errored` Verdict 写成 `<error>`；集合来自同一 `AnalysisSample`。

### 5. 静态 export

`view --out` 用真实浏览器验收，并同时检查：

- 输出目标必须不存在；全部 route、download 和 static asset 路径在创建临时目录前通过规范化、冲突与逃逸校验。
- 所有页面与资源完成后才以一次 rename 发布；失败时目标目录仍不存在。
- 页面在断网、禁 JavaScript 的宿主条件下可读；浏览器不需要源 Record 或 NiceEval 安装。
- 导出只含已计划页面、宿主数据、下载项和内建精确 runtime；不暴露 Record path、channel path 或 blob path。
- 本机 server 与静态站对同一 route 的文档逐字节一致，且不发出遥测或网络请求。

## 验收边界

- 自动化只证明稳定、公开、可观察的边界；不复制 Record reader、decoder、execution projector 或报告计算作为第二套真相。
- 模型输出质量不做确定性断言，只断言文件集合、状态、字段形状、分母、路由和两宿主口径。
- Record 与 Reports 的实现尚未到达本文目标契约时，保留本文并登记实现缺口；不要把测试计划降格回旧 Results、Graph 或版本化存储模型。
- 渲染的颜色、像素与私有 class 不属于此契约；可访问文字、页面结构、离线路由和可下载结果属于契约。

## E2E owner anchors

### report-config-reload

`report-config-reload.test.ts` 验证运行中的 view 重新加载项目模块、配置和 Record，并能从报告配置错误中恢复。

### report-execution-evidence

`report-execution.test.ts` 验证 `show --execution` 从本轮 Record 读回确定性的对话与工具调用证据。

### report-static-export

`report-export.test.ts` 验证 `view --out` 从本轮报告事实导出可读的自包含静态站。

### report-show-json

`report-show.test.ts` 验证 `show --json` 读回本轮完整运行的状态、分母和机器格式。

### report-source-snapshot

`report-source.test.ts` 验证旧 locator 的 source 详情读取 origin Run 的源码快照，不读取修改后的工作树。

### report-browser-journey

`report.browser.spec.ts` 验证自定义报告从真实运行、静态导出到产品 view server 的浏览器 Journey。
