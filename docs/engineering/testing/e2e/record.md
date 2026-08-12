# 功能域 · Record

本域拥有公开 `niceeval/record` API 与 [Record 架构](../../../feature/record/architecture.md) 的磁盘契约。
它由 `e2e/record/` 功能 Repo 承担；manifest 的 `areas` 包含 `record`，并进入无密钥 PR lane。

## record-public-api-roundtrip

此 owner 通过候选 tarball 的公开 writer 与 reader 完成一轮写入、发布和读回；边界与验收命题如下。

公开边界：

- 从候选 tarball 的公开 `niceeval/record` export 进入，不 import 根 `src/` 或内部子路径；
- `openRecordWriteSession({ root })` 只接收 typed 写入，不接受 raw JSON envelope 或任意物理 path；
- writer 直接向 `runs/<RunId>/` 写入 Run Core、origin Attempt、Member 与 typed `RecordAttachment`，全部 flush 后最后以 exclusive create 建立零字节 `complete`。完成标识是唯一发布信号；`publish` 返回 `RecordPublishReceipt` 后 draft 永久 consumed；
- 完成标识创建前，`runs/` 中不存在该 Run 的 durable 事实；reader 不把它当 Run，不展示也不复用；
- `EvaluationRecordContract` 在 generic writer 前验证 Evaluation 领域事实。generic writer 只验证 Core、owner、typed definition、exact encoding、owner-local blob closure 与精确引用，不知道内建 RecordAttachment 名称；
- `defineJsonRecordAttachment` 从 `Schema.AnyNoContext` 推导 `Type` 与 encoded 值，固定 parse options `errors: "all"` 与 `onExcessProperty: "error"`。对 `niceeval.` 前缀返回 `Either.left`（code `niceeval-namespace-reserved`），没有异常出口；
- decoded Payload 与 encoded 值都没有递归 JSON 泛型上界；Date、BigInt 等值必须由作者 schema 显式转换；
- `makeRecordAttachmentWrite` 只接受 family 与 typed payload 的配对；Run 槽位只接受 Run-owned write，Attempt 槽位只接受 Attempt-owned write，owner 混用是类型错误；
- `reference` 的 handle 必须来自同一 session 的 `view`，跨 session 使用返回 typed state error；`publish` 验证 expected slots、Member、origin Attempt 与 owner-local closure 后才写完成标识；
- `FrozenRecordView.attempt` 返回 `RecordCoreRead` 三态（`available`、`missing`、`core-invalid`）；受控 Attachment read 返回 Effect 且只输出已解码 typed 值，不暴露 path 或 raw bytes；
- `record.json` 探测或完整文档损坏返回 `record-bootstrap-invalid`，与 entry 级 `RecordCoreRead.core-invalid` 区分；
- 公开格式 fixture 的 schema version、字段与 expected 是签入字面量，不从候选常量生成；
- 未逐项声明的 `.niceeval-local` 位置、session、lock 与 cache 属于私有实现；
- 私有布局可以作为 diagnostic artifact 收集，但不决定 verdict。

## record-tsc-boundary

公开 TypeScript 边界由签入的 tsc fixture 守护，包含以下组合：

- 普通 named interface 与 `Schema.Struct` 两种 schema 形态都能从 exact schema 推导 `Type`，且不要求 `PortableJsonValue` 上界；
- `defineJsonRecordAttachment` 的 owner、name、schemaId 与 schema 组合逐项校验，非法输入只以 `Either.left` 返回。四种 `RecordAttachmentDefinitionError` 保持可区分；
- `defineRecordAttachmentMigration` 要求相同 owner、相同 name 与精确 `vN → vN+1`；跳版、倒序、跨 name 或跨 owner 返回 definition error；`defineRecordAttachmentFamily` 拒绝缺边、重复边、分叉与跳过版本；
- wrong owner 的 write 在类型层被拒绝；数组擦除 `Payload` 后仍不可伪造；
- brand transplant：复制公开字段或 phantom symbol 的 definition、projector、write 对象在运行时被拒绝（`record-attachment-definition-invalid` 等具名错误），不能形成可写 capability；
- Effect R 拆分：reader 不需要 writer lock 与 entropy 类型；把 writer-only service 放入 reader R 是类型错误。

## record-open-current-only

普通 reader 只打开 current major，不接受旧 major 的兼容读取或自动迁移。验收：

- root 是 current major 时 `openRecordReader({ root })` 返回 `RecordReader`；构造过程取得 shared maintenance lock、读取 exact `record.json` 并冻结已完成 Run 集合；
- 已知旧 major 返回 `record-migration-required`，错误携带 source、target 与 `niceeval migrate` 命令；
- future 或 foreign format 返回 `record-format-unsupported`；
- open 从不自动改写磁盘，Library 不提供 compat reader，也不在 open 时注册跨 major Core decoder；
- `record.json` 坏或超探测上限返回 `record-bootstrap-invalid`；
- reader 的 `warnings` 是 snapshot 的一部分：未完成 Run 不进入 `runs`，只产生 `incomplete-run` warning 与 `niceeval clean` 提示；
- 执行 `niceeval migrate` 后同一 root 可由普通命令打开，`recordId`、RunId、SlotId 与 AttemptId 保持不变。

## record-attachment-isolation

每个 owner-local RecordAttachment 独立落盘，坏 envelope 或 payload 只影响该 Attachment。验收：

- 每个 RecordAttachment 位于所属 owner 的 `attachments/<name>/{attachment.json,payload.json,blobs/**}`，目录名与 envelope 的 `name` 精确相等；
- 坏 envelope、坏 payload 或坏 blob closure 只让该 Attachment 变成 `RecordAttachmentRead.invalid`，不影响 Core 与其它 Attachment；
- 目录不存在返回 `unavailable`；未注册 family 或 schema 返回 `unsupported`，两者与 `invalid` 保持可区分；
- 已知旧 schema 且有完整相邻 converter 链返回 `migration-required`；路径命中 `not-losslessly-migratable` 边返回 `migration-unavailable`，两者都不伪造 current value；
- blob reference 只可指向同一 RecordAttachment 目录的 `blobs/**`，跨 Attachment、跨 owner 或 root 外引用在写入时被拒；
- Core 不保存 attachments 列表或 combined index；Core 损坏时 reader 拒绝形成可信 owner handle；
- projector 对 payload 的预期语义拒绝必须显式返回 issues；callback throw 是 defect，由 Report 边界隔离成 execution problem，不能伪装成 Attachment invalid；interruption 不吞。

## record-incomplete-run-clean

没有 `complete` 的 Run 目录不是 Record 事实。验收：

- writer 在完成标识前 interruption、I/O failure 或进程退出，目录保持未完成；后续 reader 忽略它并返回 root 级 `incomplete-run` warning，不加入 candidates、Sample 或 reuse；
- 显式选择未完成目录对应的 RunId 时仍不是已发布 Run；selection 返回 `not-recorded`，root 级 warning 保留；
- `niceeval clean` 取得 writer lock，列出未完成目录并要求确认；非交互必须 `--yes`；
- 删除前重新检查完成标识：并发 writer 正在工作时返回 busy；已经出现完成标识的目录跳过且不删除；有完成标识但 Core invalid 的 Run 永远不属于 clean 范围；
- clean 只删除未完成目录，不修改已发布 Run。

## record-effect-scope

Record API 的资源生命周期由 Effect Scope 承担。验收：

- `openRecordReader` 依赖 `Scope.Scope | RecordFileSystem | RecordMaintenanceLock`；`openRecordWriteSession` 再加 `RecordWriterLock | RecordEntropy`。clean 与 migration 各自按 [Record CLI](../../../feature/record/cli.md) 声明的能力要求精确 Tag；
- 六个能力都是独立 `Context.Tag`，没有聚合 tag，Node layer 只 `mergeAll` Layers；
- reader Scope 关闭后，需要 I/O 的方法返回 `record-reader-closed`；pure `AnalysisSample`、`ProjectedSample` 与 `ReportExecution` 不访问已关闭 Scope 的 Record；
- Core 损坏等可隔离结果保持在成功 ADT 内；权限、I/O、busy、closed 与旧 Core major 是 Effect typed error；interruption 沿 Cause 传播并触发 finalizer；
- 内部 Stream 只服务 Run 目录扫描与 blob I/O，不进入 RecordAttachment、Sample 或 Report 的公开值；
- reader 与 frozen view 的 Attachment read 都返回 Effect，按需 payload/blob I/O 可中断；closed 与 session 失配进入 typed E。

## record-maintenance-writer-lock

维护与写入并发只由 maintenance lock 与 writer lock 协调。验收：

- reader / show / view 只取得 shared maintenance lock，不取得 writer lock，可以和 writer 并发；
- writer / exp 取得 shared maintenance lock 与 exclusive writer lock；同一 root 的第二个 writer 以 `record-writer-busy` 失败，fail fast，不等待也不接管；不同 root 不协调也不自动合并；
- clean 取得 exclusive writer lock；migrate 取得 exclusive maintenance lock，与 reader、writer、clean 互斥，busy 时 fail fast；
- 锁只协调善意的 NiceEval 进程，落在 local operation state，不进入 portable Record、不进 Git；
- reader 可以漏掉刚完成发布的 Run（重新打开才有新 snapshot），但不能看见半个 Run；完成标识保证 reader 不读取中间状态。

## record-explicit-migrate

`niceeval migrate` 是唯一 Record major migration 入口。验收：

- 命令原地更新同一个 root，没有 `--out`、`--rollback`、`--keep-backup` 或 legacy-read flag；
- Core migration 只注册相邻 converter（`v1 → v2 → v3`）；每个 RecordAttachment family 也只登记且只登记一种相邻边：converter 或 `not-losslessly-migratable`；
- 迁移只转换 Core 结构表示，不运行 Attachment projector、reuse planning 或业务算法，不重算任何 RecordAttachment；
- 保留 `recordId`、RunId、SlotId、AttemptId 与全部 RecordAttachment payload closure；
- 完整相邻 converter 链缺失、family edge 不连续或 Core 无法保留 unknown owner 时，preflight 失败且不写磁盘；
- preflight 检查 `.niceeval/record` 全部内容由当前 commit 跟踪且工作区干净；无法证明时交互 CLI 要求确认、非交互必须显式 `--yes`；
- 遇到 `not-losslessly-migratable` 边时保留旧 RecordAttachment bytes，并在计划、摘要与 receipt 中逐项报告 `migration-unavailable`，不被 `--yes` 强制伪造为 current value。unknown RecordAttachment 原样保留并报告 unsupported，两者不可混同；
- 每步完成的中间版本是有效 target，可以成为下一次 plan 的 source；步骤内部中断后普通 open 拒绝解释混合 root，提示从 Git 或用户备份恢复；
- migration 不保存 durable lineage、receipt 或 rollback state；回退由 Git 或用户备份承担。

## 稳定性归属

本页只界定公开边界与 owner，不另设一套无法读取 PR diff 的执行规则。
测试变更预算及 perturbation / mutation 收据统一由
[Pullfrog review prompt](../../../../.github/pullfrog-review-prompt.md#prompt)逐文件审计。
不满足时在唯一持续审查报告中列为阻塞问题，最终态标为“需要修改”；不创建 GitHub review event 或源码行评论。
