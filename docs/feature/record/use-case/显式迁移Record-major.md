# 显式迁移 Record

本用例说明旧 Record Core 与旧 Attachment 怎样转换到当前安装版本。普通 reader 不自动
迁移，也不提供跨 Core major compat mode。

契约单源始终在 [显式 migration](../architecture.md#显式-migration) 与
[Migration Library](../library.md#clean-与显式-migration)。

## 两种 migration trigger

Core owner、引用、directory、完成判断或 shape 改变时，发布新的 `RecordFormatId`。
普通命令遇到旧 major 时整体返回 `record-migration-required`。

某个 Attachment 发布新 schema 时，不改变 Record major。请求 current family 的功能有三种
结果：

| 旧 Attachment | 读取状态 | migrate 的处理 |
|---|---|---|
| 到 current 的相邻边都是 converter | `migration-required` | 转换到 current schema |
| 路径有 `not-losslessly-migratable` 边 | `migration-unavailable` | 保留 exact old bytes |
| family 或 schema 未注册 | `unsupported` | 原样保留 |

`migration-unavailable` 是 settled state，不向用户显示 `niceeval migrate` 提示。
unknown Attachment 不是 migration-unavailable；安装 owning plugin 后才可能变成可识别的
family。

## 相邻版本链

每个 Core converter 只处理相邻版本：

```text
niceeval.record/v1 → v2 → v3
```

每个 Attachment family 的每条相邻边也必须唯一：

```text
niceeval.verdict/v1 → converter → v2
niceeval.sources/v2 → not-losslessly-migratable → v3
```

禁止跳过中间版本。用户运行一次命令，NiceEval 根据当前安装的 Core 与插件 definitions
编排完整链。

每个 Attachment family 的每个相邻边必须提供 converter，或明确声明
`not-losslessly-migratable`。第三方 converter 由定义该 Attachment 的插件提供。

## Preflight

sentinel 不存在时，命令在任何写入前：

1. exact decode source Core、可识别 Attachment envelope 与完整 closure；
2. 找到全部 Core 与 Attachment converter 链；
3. 列出无法无损迁移和 unsupported 的 Attachment；
4. 验证 ID、owner、引用和 path 仍可表达；
5. 验证 target identity 与 directory 无冲突；
6. 检查 Git restore point。

`.niceeval/record` 全部被当前 commit 跟踪且工作区干净时，Git 检查通过。否则命令显示
风险并要求确认；非交互调用必须传 `--yes`。

preflight 失败不修改任何文件。明确不可无损迁移不是失败：plan 与 receipt 列出它，且成功
执行后保留原 bytes。

## Closure-aware converter 边界

converter 接收完整 `RecordAttachmentValue<From>`，而不是独立 payload。它从
`source.blobs.open(ref)` 消费已经验证的 old bytes，并由 `target.create` 的 builder mint
每个 target ref 与 target bytes。

converter 可以：

- 保留 old bytes，但写入新的 target ref；
- 删除不再需要的 blob；
- 为 target payload 改名；
- 转换 blob bytes 后写入新的 target closure。

converter 不能：

- 把 old ref、手写 key 或 path 放进 target payload；
- 读取当前 Eval 或项目源码来补字段；
- 重新运行 matcher、Assertion evaluator、reuse planning 或 Report；
- 生成新的业务事实；
- 更换仍表示同一对象的 RecordId、RunId、SlotId 或 AttemptId。

callback 意外 throw 是 defect。`Effect.fail(e)` 是 explicit typed failure；fiber
interruption 保留 Cause。`R = never` 仅表示没有 NiceEval Layer requirement，不能证明
converter 未经 ambient JavaScript API 做 I/O。converter 即使使用 ambient I/O，也不得把
当前宿主条件伪装成历史事实。第三方 converter 是受信任 extension。

旧数据缺少新 schema 需要的事实时，target 可以显式表达 legacy unavailable。无法如实
表达时，edge 声明不可无损迁移；命令保留旧 Attachment，并让 current consumer 收到
`migration-unavailable`。

unknown 第三方 Attachment 在 owner 仍可表示时原样保留。Core 新模型无法保持它的 owner
时，preflight 拒绝整次 migration。

## Sentinel、执行与中断

第一次修改任何 portable byte 前，命令 exclusive create 并 sync root 下预期零字节的
`migration.in-progress`。Core migration 和 Attachment-only migration 都遵循此步骤。

随后命令写入并 sync 所有 target Core、Attachment 与 blob bytes。target `record.json`
始终最后写入并 sync。最后删除并 sync sentinel；只有随后 root 才再次可读。

sentinel 一旦存在，即使其内容损坏，普通 open、plan 与 migrate 都返回
`record-migration-interrupted`。命令不会自动 rollback、删除 sentinel、从某个中间 major
继续，也不会创建 `out` directory 或 compat reader。

步骤中断、kill、断电、converter failure 或写入 failure 都留下 sentinel。用户必须从
preflight 显示的 Git commit 或自己的备份恢复。NiceEval 不另存旧 root、自动 backup 或
durable migration history。

成功后 Git diff 是用户核对表示变化的入口。

## 相关阅读

- [显式 migration architecture](../architecture.md#显式-migration)
- [Migration Library](../library.md#clean-与显式-migration)
- [CLI migrate](../cli.md#migrate)
