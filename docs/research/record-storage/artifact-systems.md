# Artifact 与 CAS 系统怎样保存大材料

> 观察日期：2026-08-25
>
> 证据范围：DVC、W&B Artifacts 与 ClearML 的官方文档和官方源码

这组系统主要回答 manifest、内容寻址、cache 与大 bytes 的关系，不回答 NiceEval 的 owner、collection seal 与跨 family reference。

## DVC

DVC 把 Git 中的 `.dvc` / `dvc.yaml` pointer 与 cache/remote 中按 hash 命名的内容分开。
被跟踪目录使用 `.dir` 对象保存文件 path 与 digest 清单；相同内容可以在 cache/remote 复用。

官方资料：

- [DVC internal files](https://dvc.org/doc/user-guide/project-structure/internal-files)
- [DVC get 的 hash-addressed remote 示例](https://dvc.org/doc/command-reference/get)
- [DVC `.dir` tree 实现](https://github.com/iterative/dvc-data/blob/main/src/dvc_data/hashfile/tree.py)

对 NiceEval 的启发是：小 manifest 与大 bytes 分离、目录内容由 Host 根据 hash 组织都可行。
不能复制的是全局 cache/remote 依赖；NiceEval 的 Attachment 或 Run closure 必须在 portable root 内自包含。

## W&B Artifacts

W&B Artifact 是一个 finalize 后不可再修改的 manifest。
manifest entry 保存 logical path、digest、size、reference 与 media type；文件位于本地 cache、W&B object storage 或 reference URI。
manifest 很大时，SDK protocol 允许使用 gzip line-delimited JSON manifest 文件，而不是把所有 entry 留在一个 protobuf message。

官方资料：

- [Artifact API](https://docs.wandb.ai/models/ref/python/experiments/artifact)
- [Artifact storage and local cache](https://docs.wandb.ai/models/artifacts/storage)
- [`ArtifactManifest` protocol](https://github.com/wandb/wandb/blob/main/wandb/proto/wandb_internal.proto)

W&B 证明 manifest 本身也可能需要流式/外置表示。
它还证明 multipart 与 cache policy 可以完全留在 SDK/Host，不进入 artifact 作者模型。
但 W&B Artifact 可引用 remote URI，因此它的可携带性不等于 NiceEval 的 closure。

## ClearML

ClearML 的 Mongo Task 保存 Artifact descriptor、URI、hash、content size 与 preview；payload bytes 位于 fileserver 或对象存储。
Event 明细进入 Elasticsearch，Task 只保存可查询 summary。
离线模式另写 `task.json`、`metrics.jsonl`、`log.jsonl` 与 `data/`，最后形成 zip 供导入。

完整证据见 [ClearML storage](../record-to-report/clearml/storage.md)。

离线 envelope 展示了 JSONL + data directory 的可行性，也展示了它的局限：zip 是传输/导入格式，不自动提供在线 store 的 transaction、index 与 migration。

## 对 NiceEval 的约束

| 观察 | NiceEval 可吸收内容 | 不应复制的内容 |
|---|---|---|
| manifest 与 bytes 分离 | payload 只留逻辑 handle、length、digest 等必要事实 | 把 remote URI 当自包含 Content |
| cache/object key 由系统生成 | Host 私有 segment/object layout | 让 producer 选择 chunk 或 path |
| 大 manifest 可拆成 line records | collection item 或 manifest 可以增量形成 | 自动把任意业务数组拆行 |
| CAS 支持复用 | 只在已授权 closure 内做私有复用 | 跨 owner 的 secret existence oracle 与生命周期耦合 |
| 离线 zip 可整体搬运 | seal 后可以有 export/package projection | 把 zip 当 active append store |

这组先例强力支持 [JSON + Content store](options/json-content-store.md)，但不能证明 SQLite 无价值：CAS 解决大 bytes，不解决大量小 item 的唯一索引、分页和 transaction。
