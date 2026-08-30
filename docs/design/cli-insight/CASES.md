**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [DECISION](DECISION.md)

# Cases

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | Agent 怎样发现查询能力 | 含 sealed Run 的项目 | `query discover` 返回 compact bootstrap；按 operation 再取得 schema 与最小请求。 |
| C2 | Agent 怎样安全查询历史 | Run、locator 与 selector | `query explain/run` 从 `--request file|-` 接收 `niceeval.query/v1`，返回同一协议。 |
| C3 | 怎样比较结果 | 多个成员集合与第一方 pairing key | `side-by-side`、`exact`、`paired` 保留各自完整分母、partial、missing、issues 与 Evidence。 |
| C4 | 人怎样查看 Run | project Store、Run 或 exact locator | `show` 在终端投影固定 overview/detail；`view` 在完整 revision ready 后打开固定浏览器 View。 |
| C5 | View 遇到新 sealed Run | 两个打开的标签页 | operational source 显示更新并可原子 refresh；旧请求不能污染新 cutoff。 |
| C6 | 怎样分享封口事实 | 一个 sealed Record | `record snapshot --output` 生成 Host 验证的 Snapshot；另一个兼容 runtime 的 `view --record` 可以读取它。 |
| C7 | Snapshot 是否会混入新事实 | Snapshot 创建后 project 继续运行 | Snapshot View 没有 watcher、refresh 或 operational Store 读取，始终只见其 exact Seal。 |
| C8 | 自动化怎样观测 View 生命周期 | `view --no-open --port <port>` | 等待 loopback HTTP ready，并通过退出码、stderr、旧 session 失效和端口释放观察终态。 |
