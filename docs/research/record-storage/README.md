# Record 物理存储研究

> 观察日期：2026-08-25
>
> 文档性质：外部系统研究与候选方案，不是 NiceEval 目标契约

本方向回答一个窄问题：业务只提交逻辑事实、集合 item 与 Content 时，Record Host 应怎样把它们保存成可携带、可校验、可惰性读取的 Run。

这里把三个层次严格分开：

- 业务模型声明 `singleton`、`collection`、item identity、canonical order 与逻辑 Content；
- Host 决定 inline、row、object、segment、transaction 与 publication；
- published reader 只暴露逻辑 value、item 与连续 Content，不暴露 SQLite row、path、chunk 或 object key。

「是否需要 Content」和「是否采用 SQLite」不是同一个问题。
二进制、大文本、byte-exact snapshot 与按需读取材料需要逻辑 Content；Content 最终落进文件 segment 还是 SQLite chunk row，是 Host 的物理选择。

## 研究入口

| 页面 | 回答的问题 |
|---|---|
| [NiceEval 当前证据](current-niceeval.md) | 现行实现在哪里整体加载、受哪些预算限制、哪些语义已经定稿 |
| [Eval 与 tracing 平台](eval-platforms.md) | MLflow、Langfuse、Phoenix、ClearML、W&B 与 Aim 怎样分开小事实和大材料 |
| [Artifact 与 CAS 系统](artifact-systems.md) | DVC、W&B Artifact 与 ClearML 怎样组织 manifest、cache、remote 与大 bytes |
| [便携格式](portable-formats.md) | SQLite、DuckDB、Parquet/Arrow 与 Perfetto 分别适合写入、查询还是导出 |
| [候选方案比较](options/README.md) | 四种 NiceEval 方案的共同约束、收益、代价与翻转条件 |
| [独立设计挑战](design-challenge.md) | SQLite 候选经过哪些质疑、发生了哪些修订、为什么判定是 `CONDITIONAL` |
| [Attachment aggregate Content budget 挑战](aggregate-content-budget-challenge.md) | 为什么移除 128 MiB 合计上限仍要保留单 Content 与 storage-neutral 结构 ceiling |

## 当前研究判断

外部系统没有给出一个可以直接照搬的答案，但呈现出稳定模式：

1. 可查询的小事实与大材料通常采用不同物理路径；业务作者不决定 multipart、chunk 或对象 key。
2. 在线平台优先共享数据库与对象存储，解决持续摄入和跨 Run 查询，不提供 NiceEval 所需的 self-contained immutable Run closure。
3. Artifact 系统擅长 manifest、CAS 与 remote，却通常把可携带性建立在外部 cache 或服务上。
4. SQLite 能同时处理大量小 item、索引、事务和单文件封装，但不会自动把一个巨大 family JSON 变成可追加集合，也不会自动提供有界 Content 写入。
5. Parquet、Arrow 与 DuckDB 更适合 seal 后的 Analysis/export；Perfetto 证明 append-friendly packet stream 可行，但它不是带 owner、reference、Content closure 与 migration 的 Record。

因此本研究暂不把「SQLite」或「自管 segment」写成既定方向：

- 若 Record 保持当前 create-once family，只修复 Content 的有界写入，首选对照方案是 [JSON envelope + Host 私有 Content store](options/json-content-store.md)。
- 若产品正式采用 generic collection item write、collection seal 与 item 级惰性读取，领先候选是 [一 Run 一 SQLite](options/sqlite-run-file.md)。
- [SQLite metadata + 外部 Content](options/sqlite-external-content.md) 只在 SQLite chunk row 的实测表现不合格、而 collection 需求仍成立时保留。
- [全 JSON](options/all-json.md) 与已观察到的大材料、深层 snapshot 和惰性读取目标冲突，不作为推荐方向。

## 不随方案改变的边界

- 作者声明逻辑数据，不声明 blob path、chunk size、SQLite table 或 transaction。
- 短、常读、可筛选的结构化事实保留 JSON 语义；二进制、大、按需或 byte-exact 的材料使用 Content。
- 物理分块不改变 logical bytes、byte length、digest、identity 或 family revision。
- published Run 不依赖项目外的全局 CAS、bucket 或数据库才能独立复制和验证。
- storage revision 与 family revision 分离；未知 family 必须能按通用信封与原 bytes 保留。
- resource limit 是具名失败；Host 不把存储超限伪装成业务 `partial`。

这些边界只有进入 `design/`、`roadmap/` 或 `feature/` 并完成相应挑战与采用后，才成为 NiceEval 契约。
