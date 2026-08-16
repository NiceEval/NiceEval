# 源码 Attachment 怎样安全演进

`niceeval.sources` 的 current envelope 是 `{ family: "niceeval.sources", schemaVersion: 1 }`。它保存
origin Run 已经形成的源码闭包；ordinary reader 只解码这个已知 current Sources definition。

## 不能把今天的文件写成过去事实

假设后续 consumer 需要一项 Sources 没有保存的依赖信息。NiceEval 不能读取当前 worktree、网络或 package
installation，再把今天得到的值写进历史 Run。

```text
schemaVersion 1 Run
  └─ 保留已封口 Sources bytes

schemaVersion 2 Run
  └─ 按新的 Sources definition 保存新增事实
```

缺失事实不能用空字符串、当前 path、猜测 digest 或 optional field 伪装。新 consumer 要么只支持
schemaVersion `2` 的 Sources，要么通过固定 maintenance step 从保存 bytes 无损形成这个 shape。

## 已知 Sources schema 的相邻步骤

schemaVersion `1` 没有已发布 predecessor，`migrate` 对完整 current Record 返回 `already-current`。future
Sources schemaVersion `2` 发布时，NiceEval 必须同时判断 `1 → 2` 是否能无损完成：

- 已保存的 payload 和 own blobs 足够时，提供固定 `1 → 2` migration；
- 目标 schema 能以 exact legacy state 表达缺失事实时，migration 写该 state；
- 无法如实表达时，不发布“看似成功”的 converter；计划拒绝改盘，历史 bytes 保持不动。

步骤只读取 `SourcesAttachment` 的 self-contained payload 和 closure。它不能运行 Eval、重新执行依赖发现、
读取当前 worktree 或调用第三方 code。目标 blob 重新属于 schemaVersion `2` 的 own closure，不能把旧 `RecordBlobRef`、path
或 key 冒充新 ref。

已知 `niceeval.sources` 的旧 schemaVersion 使 ordinary read 返回 `migration-required`。它与独立未知 future
family 不同：例如较早 reader 看到 `niceeval.energy` 时保留其 bytes、跳过解释并继续读取 Sources；它不会试图
把 unknown energy 当成 Sources 的旧版本，也不会把它加入 migration plan。

## Source identity 保持或整体改变

只要 `SourceItemId`、path、digest 和 source-site join 的语义不变，schemaVersion `2` 可以单独演进 Sources payload。
source-site reader 继续以相同 identity 连接 origin Run 的 manifest。

如果 `SourceItemId` 或 source-site join 的语义需要改变，migration 必须把 Sources 与依赖该 identity 的
Assertions / diagnostics mapping 作为同一 atomic migration unit。不能分别迁移它们，也不能按 path、digest、
数组位置或当前 worktree 猜 mapping。Run 要么保留完整旧事实，要么以一致的新 identity 发布。

## 什么仍然不是 Sources migration

| 变化 | 正确 owner |
|---|---|
| source viewer 的 typed view 或 UI | Analysis / Report |
| 静态依赖发现和输入比较语义 | behavior identity |
| reuse 接受集合 | Experiment reuse policy |
| Sources payload 或 closure 的持久语义 | Sources schemaVersion + fixed migration |
| Sources owner、跨 owner blob 或 Core reference | 下一 Record format |

Sources migration 不授权跨 Run blob pool、root 外文件或第三方 durable field。那些改变会破坏 portable closure
与 Core 公理。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [显式 migration](显式迁移Record-major.md)
- [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md)
