# 功能域 · Record

本域拥有公开 `niceeval/record` API 与 [Record Format](../../../feature/record/architecture.md) 的磁盘契约。
它由 `e2e/record/` 功能 Repo 承担；manifest 的 `areas` 包含 `record`，并进入无密钥 PR lane。

## record-public-api-roundtrip

此 owner 通过候选 tarball 的公开 writer 与 reader 完成一轮写入、发布和读回；边界与验收命题如下。

公开边界：

- 从候选 tarball 的公开 `niceeval/record` export 进入，不 import 根 `src/` 或内部子路径；
- `openRecordWriteSession` 只接收 typed Core 与 typed Channel writes，不接受 raw JSON envelope 或任意物理 path；
- 完整 Run 经 `stageRun`、`sealRun` 与 `publishRun` 发布后，`openRecordReader` 能在同一 root 读回同一批 Run、Attempt 与 Channel identity；
- 公开格式 fixture 的 schema version、字段与 expected 是签入字面量，不从候选常量生成；
- 未逐项声明的 `.niceeval-local` 位置、staging directory、分片与索引布局属于私有实现；
- 私有布局可以作为 diagnostic artifact 收集，但不决定 verdict。

## record-open-current-only

普通 reader 只打开 current major，不接受旧 major 的兼容读取或自动迁移。验收：

- root 是 current major 时 `openRecordReader` 返回 `RecordReader`；构造过程只导航 Core，不自动形成任何 Channel projection；
- 已知旧 major 返回 `record-migration-required`，错误携带 sourceFormat、targetFormat 与 `niceeval migrate` 命令；
- future 或 foreign format 返回 `record-format-unsupported`；
- local migration state 未收敛时返回 `record-migration-recovery-required`，优先于格式判断；
- 执行 `niceeval migrate` 后同一 root 可由普通命令打开，`recordId`、RunId、SlotId 与 AttemptId 保持不变。

## record-channel-isolation

每个 owner-local Channel 独立落盘，坏 envelope 或 payload 只影响该 Channel。验收：

- 每个 Channel 位于 `channels/<channel-name>/{channel.json,payload,blobs/**}`，目录名与 envelope 的 `name` 精确相等；
- 坏 envelope 或坏 payload 只让该 Channel 变成 `ChannelProjectionResult.invalid`，不影响 Core 与其它 Channel 的 projection；
- 没有同名 envelope 返回 `unavailable`；schema 或 media type 不被当前 projector 接受返回 `unsupported`；
- Core 不保存 channels 列表或 combined index；Core 损坏时 reader 拒绝形成可信 owner handle；
- projector 对 payload 的预期语义拒绝必须显式返回 issues；callback throw 是 defect，Report 边界隔离成 `execution-failed`，不能伪装成 input invalid；interruption 不吞。

## record-effect-scope

Record API 的资源生命周期由 Effect Scope 承担。验收：

- `openRecordReader` 与 `openRecordWriteSession` 依赖 `Scope.Scope | RecordPlatform`，由 Layer 提供 service；
- reader Scope 关闭后全部方法返回 `record-reader-closed`，并释放 shared maintenance lease；
- `view` 的每次 rebuild 在各自 Scope 中打开 reader、形成完整自包含输入并关闭该 reader Scope；
- Sample、ReportInput 与 ReportExecution 不访问已关闭 Scope 的 Record；
- NDJSON 与大型 blob 的 Stream 在 reader Scope 内穷尽消费，不进入 `ChannelProjectionResult`、`AnalysisSample` 或 `ReportInput`；
- Core 损坏等可隔离结果保持在成功 ADT 内；权限、I/O 与 closed lifecycle 是 Effect error。

## record-maintenance-writer-lock

维护与写入并发只由 maintenance lease 与 writer lock 协调。验收：

- reader 只取得 shared maintenance lease，不取得 writer lock，可以和正常 writer 并发；
- 同一 root 的第二个 writer 以 `record-writer-busy` 失败；不同 root 不协调也不自动合并；
- `niceeval migrate` 与所有 reader、writer 和 recovery 互斥；busy 时 fail fast，不等待也不接管；
- 锁顺序固定：先 shared maintenance lease，再 exclusive writer lock；migrate 先取 exclusive maintenance lease，再按 source version 取 writer lock；
- reader 可以漏掉刚发布的 Run，但不能看见半个 Run。

## record-atomic-publish

完整 Run 通过一次 no-replace atomic publish 出现。验收：

- `atomicPublishDirectoryNoReplace` 把 staging 发布到 `runs/<runId>`；目标以任意文件类型存在时返回 `record-publish-target-exists`，既有目标原封不动；
- 发布前一个字节都不在 durable root；发布后整个 Run immutable，没有 edit、delete 或补写 API；
- 写入方在 rename 前 sync 全部 payload 与目录，rename 后 sync target parent，才返回 durable receipt；
- 平台或文件系统不能证明 no-replace 与 atomic visibility 时返回 typed unsupported，不允许 `exists + rename` 或 copy fallback；
- 两个进程竞争同一 target 时恰好一个成功；外部修改已发布 Channel 后，下一次 reader 只把该 Channel 报为 `invalid`，不自动修复、不 revision、不改写其它 Run。

## record-explicit-migrate

`niceeval migrate` 是唯一 Record major migration 入口。验收：

- 命令原地更新同一个 root，没有 `--out`、`--rollback`、`--keep-backup` 或 legacy-read flag；
- 迁移只转换 Core 结构表示，不运行 Channel projector、reuse planning 或当前算法，不重算任何业务 Channel；
- 保留 `recordId`、RunId、SlotId、AttemptId 与全部 Channel payload closure；
- 无法证明事实一一等价时返回 `record-migration-not-lossless`，public root 保持 source format；
- 进程崩溃或 cleanup 中断后，普通命令返回 `record-migration-recovery-required`；再次运行同一命令按 recovery matrix 收敛现场；
- 迁移不写 durable lineage、receipt 或 rollback state；回退由 Git 或用户备份承担。

## 稳定性归属

本页只界定公开边界与 owner，不另设一套无法读取 PR diff 的执行规则。测试文件、fixture、expected 是否超出变更预算，
以及 contract-preserving perturbation 与公开格式 mutation 的收据是否充分，统一由
[Pullfrog review prompt](../../../../.github/pullfrog-review-prompt.md#prompt)逐文件审计并给出 `Request changes` verdict。
