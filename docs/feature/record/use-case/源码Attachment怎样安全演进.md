# 源码 RecordAttachment 怎样安全演进

本用例说明已经发布的 Sources schema 缺少未来 consumer 所需事实时怎样演进。

## 不能补写历史事实

假设 v1 没有保存一种后来需要的依赖信息。升级后的 NiceEval 不能读取当前 worktree，再把今天的文件当成过去 Run 的事实。

```text
历史 Run → niceeval.sources/v1   保持原样
未来 Run → niceeval.sources/v2   写入新契约要求的事实
```

Sources 仍由 Run owner 持有，因此 Record Core 不变。

## 相邻 converter

如果变化不改变 `SourceItemId` 与 source-site source ref 的 identity 语义，v2 definition 必须声明
Sources 的普通 `v1 → v2`：

- 旧数据足以形成 v2 时，提供 closure-aware converter；
- v2 能如实表达 legacy unavailable 时，converter 保存该状态；
- 无法无损表达时，声明不可迁移。

不可无损迁移的 v1 bytes 保留。请求 v2 的功能得到 `migration-unavailable`，而不是从当前 worktree、网络或其它 RecordAttachment 补值。它不提示重跑 migrate。unknown schema 才是 unsupported。

## Source identity migration group

`SourceItemId` 的意义或 source-sites source ref 的解释改变时，不能分别运行 Sources 与
source-sites converter。它们各自发布相邻 schema version，并作为一个 source identity migration
group 注册：

```text
origin Run 的完整旧 Sources
  → 唯一 old-to-new SourceItemId mapping
  → 同一 Run 每个匹配的 source-sites Attachment
```

group 只从完整旧 Sources value 建立 mapping，并将同一份 frozen mapping 传给每个 source-sites
converter。converter 不得从 path、digest、数组位置、当前 worktree 或自己的 Attempt payload 猜测
对应关系。Sources target 与全部可转换 source-sites target 一起写入，不能发布混用两代 item identity
的 Record。

若无法给出无损 mapping，group 显式声明 `not-losslessly-migratable`。相关旧 bytes 保持原样，
current source navigation 返回 `migration-unavailable`；它不会由其它 owner 补读 source blob 或 path。

## typed view 与 behavior identity

| 变化 | 动作 |
|---|---|
| source payload 或 closure，且 source item identity 不变 | 新 `RecordAttachmentSchemaId` 与相邻 migration policy |
| `SourceItemId` 或 source-site source ref identity 语义 | 相邻 source identity migration group |
| typed view 类型或解释 | 新 projector/API |
| source discovery 或输入比较语义 | 新 input/behavior identity |
| reuse 接受集合 | 新 reuse policy domain |
| owner、跨 owner 引用或 portable closure | 新 Record major |

新增只用于展示的 source 字段不自动使旧 Attempt 失去 reuse 资格。反过来，依赖发现算法改变时，即使 RecordAttachment bytes 不变，也可能必须切换 behavior identity。

## 何时才是 Record major

保持 Run-owned Sources 与 RecordAttachment-local blobs 时，增加 schema version 不改变 Core。

普通 converter 与 group 的 Sources step 都从完整、自包含的 in-memory source value 以
`bytes(ref)` 读取旧 blobs。它们不重新打开 storage 或消费读取 Stream。

source payload 是 package-owned deep-frozen JSON snapshot，不能以 mutation 改写其它
consumer 所见的事实。

converter 再为 target payload mint 新 refs，并以写侧 Stream 提供 target bytes。

改成跨 Run 全局 blob pool、允许 RecordAttachment 引用 root 外文件，或者改变 Sources owner 时，所有 reader 都必须理解的新公理已经出现。此时发布新的 Record major，并提供相邻 Core converter。

## 相关阅读

- [三个演进边界](../architecture.md#三个演进边界)
- [Sources manifest](../architecture.md#sources-manifest)
- [Source identity migration group](../library.md#source-identity-migration-group)
- [Assertion source sites](../../assertions/architecture/source-sites.md)
- [选择正确的演进边界](未来功能不扩张核心格式.md)
- [显式 migration](显式迁移Record-major.md)
