# Reports 怎么测

契约出处：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md) 与 [Calculations](../../../feature/reports/calculations.md)。

单元层只证明 Reports 的纯数据语义、计划校验与受控 accessor。真实 Record 读取、两种宿主、静态 export 和浏览器结果由 [E2E · Record 与 Reports 读面](../e2e/report.md)验收。

## Fixture 规范

fixture 直接构造 core-only Sample、ReportScope、transport reads 和 ReportPlan。它不构造 Record root、reader、revision、proof 或旧图模型，也不复制 decoder、parser 或 planner 的生产实现。

通过率等 Calculation fixture 必须让常见错误算法得到不同答案。例如 included、not-recorded、invalid、excluded 和 `errored` 不能恰好给出相同分母。partial 值同时带 observed 与 denominator；零、缺失和不可用保持三种不同输入。

## 最小证明面

- **plan 纯度**：`plan(scope)` 只能看到 Run、slot、Attempt identity 和 Sample 状态；同一输入得到相同冻结 plan。重复 route、download path、consumer id 或不同 requirement 对象复用 id 时得到 `report-plan-invalid`。
- **build 权限**：`buildReportInput` 只读取 plan 声明的 owner + requirement。Run requirement 包含零 included slot 的 Run；Attempt requirement 只读 included slot 引用的唯一 Attempt。未请求通道的 fake 必须保持零调用。
- **transport 状态**：complete、partial、unavailable、unsupported、invalid 各有一条能区分相邻状态的 fixture。builder 保留局部状态，不把一个坏 read 扩散成整体失败。
- **execute 次数**：custom parser 对每个 owner identity + requirement object 恰好一次；Calculation、Page 和 Download 各至多一次。多个 consumer 共享同一 requirement 时复用结果，不重算也不重读。
- **受控 accessor**：consumer 只能读取自己的 inputs 和 owner 范围。未声明 requirement、错误 owner 或 Sample 外 identity 以具名输入错误失败；公开值中没有 RecordReader、recordRoot、channel path 或 blob path。
- **Calculation**：结果保留 ref、value、completeness 与 issues，并按 plan 顺序进入 ReportExecution。错误算法若丢分母、把 null 变零或把 partial 当 complete，fixture 必须失败。
- **宿主同源**：text 与 web formatter 消费同一个 ReportExecution 普通值。单元层断言语义树和格式化值，不用私有 DOM class 或完整字符串黄金文件代替 E2E。
- **静态路径预检**：route、download 和 asset path 的规范化、ASCII case-fold 冲突、保留名与逃逸使用纯输入表验证。文件系统创建、临时目录和一次 rename 归 E2E。

## 不这样测

- 不恢复旧内建组件清单、隐式详情页、跨 Run 历史聚合或位置参数切片测试。
- 不让 fake RecordReader 重新实现核心验证；它只采集被请求的 owner + requirement 并返回给定状态。
- 不在单元层证明 CSS、浏览器离线性、页面交互或 server/export 字节一致性。
- 删除任一测试时要能说明会放走哪条当前 Reports 契约；旧 Results/Graph 行为不构成保留理由。
