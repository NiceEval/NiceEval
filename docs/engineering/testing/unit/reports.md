# Inspection 与 Delivery 怎么测

契约出处：[Inspection 与第一方 Delivery](../../../feature/reports/README.md)与
[Architecture](../../../feature/reports/architecture.md)。真实 CLI、Record 打开和浏览器结果由
[E2E · Inspection 与 Delivery](../e2e/report.md)验收。

自动化产品测试处于重置期。本页只约束既有 Unit 例外如何收敛，不授权新增或恢复测试 owner。固定 operation 的选择、
Record 读取、资源生命周期和公开 document 必须从安装后的 E2E 入口证明。

## 可以保留的纯边界

- canonical machine document 的字段排序、byte ceiling 与 correction 编码；
- `side-by-side | exact | paired` 的穷尽 comparison 纯函数，其中 fixture 必须让错误分母或错误配对得到不同结果；
- query codec 对已经闭合的 Inspection result 的纯映射；
- View 私有 view-model builder 对同一闭合 result 的确定性映射。

fixture 只提交 operation 已经允许的 plain-data request/result。它不伪造 Record reader、SQLite rows、Content handle、Scope、
selection catalog 或 Host，并且不复制 operation 的选择、分母、missing、Evidence 或 pairing 算法。

## 不这样测

- 不恢复 Population、Measure、Relation、Sample、Page、theme、component 或 renderer 作者协议；
- 不让 fake reader 或 fake Host 重实现 Core、family、Seal 或 Snapshot 验证；
- 不在 Unit 层证明 CLI stdout/stderr、浏览器授权、last-good revision 或资源回收；
- 不把旧 Report 作者框架的实现行为当作保留现有测试的理由。
