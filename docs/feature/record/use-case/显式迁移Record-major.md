# 显式 migration 与 Git 边界

本页说明 `niceeval migrate` 怎样区分 current Attachment、可达的历史版本、未知 family 与 legacy root。
契约单源始终在 [Record Architecture](../architecture.md) 和 [Record CLI](../cli.md#migrate)。

## 无版本 current root

完整 current Record 的 root 是：

```json
{ "format": "niceeval.record.attachments", "recordId": "..." }
```

root 没有递增 revision；durable interpretation revision 只属于 exact attachment persistence。所有 inventory 都 current 时，
命令不写盘：

```sh
niceeval migrate --record .niceeval/record
# Record migration plan: already-current
# format: niceeval.record.attachments
# Record migration already-current.
```

ordinary reader 从不迁移或写盘：

| 发现的 bytes | ordinary read | `migrate` |
|---|---|---|
| current root、请求 family 已 current | 局部读取 | `already-current` 或迁移其它 family |
| 已贡献 definition 的受支持 predecessor | `migration-required` | 运行严格相邻单链 |
| 已知 future revision 或 migration chain 缺口 | `unsupported-format` | 拒绝且不触碰 bytes |
| inventory 含未贡献 family，但当前读取不依赖它 | 继续无关局部读取 | complete plan 返回 `family-definition-required` |
| direct/reference closure 需要未贡献 family | `family-definition-required` | 取得 definition 前不迁移 |
| legacy root `niceeval.record.source-receipts` | `record-migration-required`，不动态加载 decoder | 显式 migration 选择固定 decoder |
| legacy root `niceeval.record` | `record-format-unsupported` | 安装支持该 beta format 的 NiceEval |

未知 family 既不是 valid，也不是 invalid。局部读取可以绕过无关 inventory；`requireComplete()`、Seal rebuild
与 migration completion 必须拥有全部 definition 才能成功。

## Family-owned 相邻步骤

`defineRecordAttachment()` 声明 current logical fact。
`defineRecordAttachmentPersistence()` 以 exact attachment brand 绑定 durable revision 和 private adjacent migration。Record Core 只执行统一协议：

1. Core 验证 source 的 storage-neutral tokenized document 与通用 physical/token closure。
2. family-private parser 证明旧业务 closure，并调用纯 migration。
3. 相邻中间 revision 只在内存流转；Core 只验证并写 current logical result 的 closure。
4. 最后 atomic replace `attachment.json`，提交 current result。
5. 所有 Attachment current 后重建、验证并 atomic replace Seal。

步骤不能读取当前 Eval、项目文件、网络、provider、时钟或随机源，也不能重新运行 matcher、Assertion evaluator、
reuse planning 或 Report。它可以显式丢弃无法保持语义的旧字段，但 plan / receipt 必须列出 dropped facts 与重跑建议。

官方、第三方 package 与 Plugin family 使用同一机制。migration plan 来自调用方显式组成的 immutable catalog，
不是全局 registry，也不接受运行中后写替换。

## 中断、续跑与失败

Record 不创建 migration sentinel、journal、backup、restore commit 或 rollback metadata。每个 envelope 是所属
Attachment 的唯一 durable commit record：

- target content 已写但 envelope 未替换时，旧 envelope 仍是 truth；重跑可以复用相同 digest object。
- current envelope 已替换但 receipt 未返回时，重跑跳过该 Attachment；相邻中间 revision 从不写盘。
- 部分 Attachment current、Seal 尚旧时，ordinary complete read fail closed；显式 migration 继续 pending steps，
  最后重建 Seal。
- 任一 Attachment 失败时保留先前已提交的 current envelopes，报告 committed、pending、failed 与 orphan candidates，不做隐藏 rollback。

迁移必须确定性、可续跑。相同 source envelope 和 content 产生相同 target logical value 与 content identity；已经
current 的步骤不会重复执行。

## Git 只属于用户历史

NiceEval 不调用 `git status`、不检查 HEAD / index，也不执行或生成 `git restore` 命令。Record 是否跟踪、dirty
或位于 Git worktree 都不影响 migration 的合法性。

用户可以在迁移前自行 commit 或复制 `.niceeval/record`，并用 Git 查看 diff、restore 或 rollback。这个历史恢复
能力不进入 Record service、plan identity 或 portable bytes。

## 相关阅读

- [Record CLI](../cli.md#migrate)
- [Attachment definition 与 closure](../architecture.md#defineRecordAttachment-spi)
- [源码 Attachment 怎样安全演进](源码Attachment怎样安全演进.md)
