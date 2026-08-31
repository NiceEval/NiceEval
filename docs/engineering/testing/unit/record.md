# Run persistence 怎么测

契约出处：

- [Run](../../../feature/run/README.md)
- [Architecture](../../../feature/run/architecture.md)
- [Library](../../../feature/run/library.md)
- [Run → Inspection → Delivery](../../../feature/run-inspection/README.md)

本页登记 Run Core 与内部 SQLite adapter 中可稳定隔离的算法 seam。真实 Run 创建、Attempt publication、CLI 读取与
Inspection/View 接线由安装后的 E2E owner 验收。内部 adapter 名称、表、migration、generation 与 GC 都不形成公开契约。

## Fixture 规范

每例使用独立临时数据库，并显式给出 Run、expected slots、Attempt identity、publication revision、origin/reference
binding 与 Run state。builder 不替测试生成决定结果的 identity、action、revision 或默认状态，也不复制 production
publication 算法。

## 最小证明面

- Run create 原子冻结 expected slots、invocationId、初始 active state 与 writer generation；
- origin publication 原子提交 Attempt closure、publication identity 与 origin binding；
- reference binding 只能指向已发布 Attempt，并与 origin publication 竞争同一个 slot CAS；
- Run close 原子提交终态与所有剩余 absence reasons，终态拒绝新 binding；
- PublicationCutoff 按 generation 与 revision 重建一致事实，晚到 publication 不污染既有读取；
- recovery 先推进 writer generation 并 fence 旧 writer，再把有证据的 orphan Run 收口；
- deletion 与 reference binding 串行化，存在 incoming reference 时零删除；
- portable gate、retention 与物理回收保持上述领域结果，不进入用户输入或公开错误修复流程。
- canonical SQLite coordination 用精确 host/pid/boot/process-start identity 与 owner generation CAS fence 旧 writer。
  heartbeat 年龄不构成 takeover 证据；Invocation 终态 projection 通过 portable reopen 保留，旧 locks/sessions entry 在 mutation 前 fail closed。

## 不这样测

- 不恢复旧持久 API、通用 definition/writer、portable snapshot 或 maintenance 流程；
- 不把 SQLite row、文件布局或内部状态类型名当 outcome oracle；
- 不让 fake 重实现 publication transaction、cutoff 或 reference eligibility；
- 不在 Unit 层复制完整 Inspection 或 View。
