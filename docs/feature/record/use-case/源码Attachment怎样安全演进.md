# 源码 Attachment 怎样安全演进

`niceeval.sources/v1` 是首个支持的 Sources schema。它保存 origin Run 已经形成的源码闭包；只有
exact v1 bytes 可以被 v1 reader 解码。

## 不能把今天的文件写成过去事实

假设后续 consumer 需要一项 v1 没有保存的依赖信息。NiceEval 不能读取当前 worktree、网络或 package
installation，再把今天得到的值写进历史 Run。

```text
v1 Run
  └─ 保留其已封口 Sources bytes

v2 Run
  └─ 按 v2 的固定 contract 保存新增事实
```

缺失事实不能用空字符串、当前 path、猜测 digest 或 optional field 伪装。新 consumer 要么只支持 v2，
要么通过随 v2 发布的固定 migration 从 v1 保存的 bytes 无损形成 v2。

## 发布 v2 时的固定步骤

`migrate` 对 v1 返回 `already-current`，因为 v1 是首个支持格式。发布
`niceeval.sources/v2` 时，NiceEval 必须同时判断 v1→v2 是否能无损完成：

- v1 已有的 payload 和 own blobs 足够时，提供固定 v1→v2 migration；
- v2 能以 exact legacy state 表达缺失事实时，migration 写该 state；
- 无法如实表达时，不发布“看似成功”的 converter；迁移计划拒绝改盘，历史 bytes 保持不动。

步骤只读取 `SourcesAttachmentV1` 的 self-contained payload 和 closure。它不能运行 Eval、重新执行
依赖发现、读取当前 worktree 或调用第三方代码。目标 blob 必须重新属于 v2 的 own closure，不能把旧
`RecordBlobRef`、path 或 key 冒充新 ref。

## Source identity 保持或整体改变

只要 `SourceItemId`、path、digest 和 source-site join 的语义不变，v2 可以单独演进 Sources payload。
source-site reader 继续以相同 identity 连接 origin Run 的 manifest。

如果 `SourceItemId` 或 source-site join 的语义需要改变，v2 必须把 Sources 与依赖该 identity 的
Assertions / diagnostics mapping 作为同一 atomic migration unit。不能分别迁移它们，也不能按 path、
digest、数组位置或当前 worktree 猜 mapping。Run 要么保留完整 v1 事实，要么以一致的 v2 identity
发布。

## 什么仍然不是 Sources migration

| 变化 | 正确 owner |
|---|---|
| source viewer 的 typed view 或 UI | Projection / Report |
| 静态依赖发现和输入比较语义 | behavior identity |
| reuse 接受集合 | Experiment reuse policy |
| Sources payload 或 closure 的持久语义 | Sources v2 + fixed migration |
| Sources owner、跨 owner blob 或 Core reference | 下一 Record format |

Sources migration 不授权跨 Run blob pool、root 外文件或第三方 durable field。那些改变会破坏 portable
closure 与 Core 公理。

## 相关阅读

- [Sources manifest](../architecture.md#sources-manifest)
- [显式 migration](显式迁移Record-major.md)
- [跨文件 Eval 怎样进入源码闭包](跨文件Eval怎样进入源码闭包.md)
