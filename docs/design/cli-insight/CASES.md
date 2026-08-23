**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [DECISION](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | Agent 怎样从零发现查询能力 | 一个包含内建与自定义 descriptor 的项目 | 无参数 discovery 返回紧凑 bootstrap；Agent 再按 kind / ID 取得完整 schema 与最小 follow-up request。 |
| C2 | Agent 怎样发现历史选择 | 多个 Run、reference Slot 与共享 Attempt | 分页 discovery 交付 typed Run / Slot / Attempt handles 与 selector values；分页 snapshot 变化时返回 `selection-catalog-stale` 与 restart correction。 |
| C3 | 怎样自由并排不同总体 | 三个成员集合不同的 named sets | 每个 set 保留自己的 basis、Population、frame 与分母；不产生跨总体 delta、rank 或 trend。 |
| C4 | 怎样做 exact 与 paired 比较 | 多个 exact member set，另有一对具名 Relation 两端 | exact 只接受相同 Population 与 member set；paired 恰好两端，并保留左右分母、pair 分母、unmatched 与 excluded。 |
| C5 | 怎样从 Run 快速定位失败 | 一个含多个 Attempt 的 Run | `show --run` 显示层级摘要、失败 locator、`show @...` 与 `insight @...` 下一步。 |
| C6 | 怎样查看一个 exact Attempt | 一个有效或无效 Attempt locator | 有效 locator 直接进入人类详情；无效 locator 在读取重 payload 前给出具名错误与候选。 |
| C7 | 怎样启动本地 Insight | project-current、explicit Run 或 exact locator | 首 revision 与 loopback server 都 ready 后才打开浏览器；project-current 进入 overview，exact locator 进入 detail。 |
| C8 | Insight 期间发布新 Run | 两个标签页正在读旧 revision | 两个标签页继续读同一 revision并看到更新提示；确认刷新后原子切换，晚到旧响应被丢弃。 |
| C9 | Insight 刷新或打开浏览器失败 | 新 revision 构建失败，或 OS open 失败 | 构建失败保留 last-good 与 retry；open 失败保留 server 并打印带短期 credential 的 URL。 |
| C10 | 恶意网页访问 loopback | 没有本进程 session 的跨站请求 | bootstrap 不泄露数据；RPC、event stream 与 upgrade 因 session、Host 或 Origin 不匹配而拒绝。 |
| C11 | project-current 没有结果 | 零命中的当前项目 | Insight 成功打开可诊断 empty overview；它不伪造 Run，也不把零命中当 server failure。 |
| C12 | 进程被中断 | query 执行中或 Insight 正在刷新 | 全部 Sample、Record session、watcher、server 与 in-flight work 被关闭，不留下半份 machine result。 |
