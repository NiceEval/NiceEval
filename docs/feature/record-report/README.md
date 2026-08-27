---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Record → Inspection → Insight

NiceEval 的运行后数据流由三个 owner 闭合：Record 保存 sealed facts；Inspection 解释固定读取问题；Insight
以人读 SPA 审阅同一事实。中间没有 Report、统计、呈现作者层或持久 JSON DTO。

```text
operational Record SQLite
  → Record Host validates and forms a complete RecordSnapshot
  → Inspection fixed query definition
  → node:sqlite query/show | sqlite-wasm Worker → Insight SPA
```

Record 是唯一的持久事实 owner。Inspection 是 selection、sealed cutoff、member、denominator、limits、issues、
Evidence 与 comparison 的唯一 owner。Insight 只呈现它读取的闭合事实，不能从 raw runs 重算或补齐业务语义。

`niceeval query` 在 Node 中用 `node:sqlite` 编码 `niceeval.query/v1`；`niceeval show` 在同一固定
operation 上格式化英文终端文本，不拥有第二套业务聚合。`niceeval view` 启动受 session 保护的
本机 loopback Host；浏览器经受保护的 SQLite GET，在 sqlite-wasm Worker 中只读完整当前 `RecordSnapshot`。Host
只拥有 session、SPA assets、SQLite transport、refresh 和进程生命周期，不提供业务 REST API。

没有 `--record` 时，Host 可以发现新的 sealed publication。用户确认后，新的完整 Snapshot 才原子取代当前
generation；失败保留 last-good Snapshot。`--record` 只接受已验证的完整 Snapshot，固定 exact Seal，不 watch
也不 refresh。

PR Preview 使用同一候选 Insight SPA 与仓库控制的合成 `record.sqlite`。它不接收真实 Record、项目路径、
loopback session 或 secret，因此不是用户分享、静态导出或远程 Record 查看面。

`not-recorded`、`partial`、`unavailable`、`truncated` 与 `omitted` 是 current schema 上的领域结果。迁移与验证
先保证 source 的 current schema；这些结果不承担 schema 兼容或 fallback。

## 相关阅读

- [Record](../record/README.md)
- [Inspection](../inspection/README.md)
- [Insight](../insight/README.md)
