# Reports 怎么测

契约出处：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、
[Library](../../../feature/reports/library.md) 与 [Analysis Library](../../../feature/analysis/library.md)。

单元层只证明 Report 的纯闭合语义、定义校验与 Host 边界。真实 CLI、Record 打开、静态 export 和浏览器
结果由 [E2E · Record 与 Reports 读面](../e2e/report.md) 验收。

## Fixture 规范

fixture 通过受控的 `recordHost` / `analysisHost` seam 签发 Sample，或直接使用已经闭合的
`ClosedRows`、`SemanticFrame` 与 `DomainView`。它不手工构造 Sample、Record root、reader、路径、
payload 或 blob capability，也不复制 decoder、查询执行器或 reuse planning。

通过率等 Measure fixture 必须让常见错误算法得到不同答案。例如 included、not-recorded、
core-invalid 与 excluded 不能恰好给出相同分母。`MetricValue` 保留 value、state、samples、total、
issues 与 refs；零、缺失和不支持保持不同输入。

## 最小证明面

- **定义校验**：普通 Page 的 id、path、标题、可选 load 与 render 形状在任何作者 callback 前校验。
  参数化 Page 必须同时有 `navigation: false`、`params`、load 和 render。
- **参数页**：encode/decode 必须规范往返；重复 key、非规范 key、route collision、ASCII case-fold
  collision 与目录前缀 collision 都产生具名 Report 问题。static execution 对每个参数页只 enumerate
  一次，空枚举仍保留 instanceCount: 0。
- **Analysis 边界**：组件和 Page 只能对 Host-issued Sample 调用 `aggregate()` / `query()`；结果只能以
  `ClosedRows`、`SemanticFrame` 或 `DomainView` 进入显示树。未声明的事实、reader、root、path 或
  blob capability 不能进入公开值。
- **状态完整性**：`MetricValue` 的 available、partial、empty、unsupported、failed 各有能区分相邻
  state 的 fixture。错误算法若丢分母、把 null 变零或把 partial 当 complete，fixture 必须失败。
- **执行次数**：同一个 Page instance 的 load、render、复合组件和原语 `resolve` 各至多一次；相同
  Sample identity 与 Analysis 依赖复用结果，不重读也不重算。
- **闭合树**：text 与 web formatter 消费同一个 `ClosedReportTree` 普通值。树拒绝 cycle、非有限数、
  坏 Unicode、坏表格和坏图形形状；单元层断言语义树，不用私有 DOM class 或完整字符串黄金文件代替 E2E。
- **静态路径预检**：route、download 和 asset path 的规范化、保留名与逃逸使用纯输入表验证。文件系统创建、
  临时目录和一次 export 归 E2E。

## 不这样测

- 不恢复旧的图、投影声明、隐式详情页、跨 Run 历史聚合或位置参数切片。
- 不让 fake reader 或 fake Host 重实现 Core / family 验证；fixture 只提供目标契约允许的闭合输入。
- 不在单元层证明 CSS、浏览器离线性、页面交互或 server/export 字节一致性。
- 删除任一测试时要能说明会放走哪条当前 Report 契约；旧 Results/Graph 行为不构成保留理由。
