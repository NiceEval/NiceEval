# Record 怎么测

契约出处：

- [Record](../../../feature/record/README.md)
- [Architecture](../../../feature/record/architecture.md)
- [Library](../../../feature/record/library.md)
- [Sample](../../../feature/sample/README.md)

Record 单元层只证明可稳定隔离的格式算法和 reader/writer 边界。真实运行的提交、读取、Reports 接线与用户可见结果由 [E2E · Record 与 Reports 读面](../e2e/report.md)验收。

## Fixture 规范

每例在独立 `mkdtemp` 目录写出最小 `niceeval.record/v1`。fixture 显式给出 Run、expected slot、Member、Attempt identity 和 RecordAttachment definition（name 与 schemaId）；builder 不代替测试生成决定结果的身份或默认状态。

大 payload fixture 使用少量真实 bytes 证明 owner-local blob closure 边界，不签入巨大黄金目录。目录、JSON 和 blob 内容必须从公开形状构造，不能复制 reader 的验证算法作为第二套真相。

## 最小证明面

- **根与导航**：精确 `{ format: "niceeval.record/v1", recordId }` 可打开；损坏或超探测上限的 `record.json` 得到 `record-bootstrap-invalid`，旧 Results 与其它完整格式 ID 被拒且没有迁移路径。Run、Member、Attempt 分别可达 `RecordCoreRead.available`、`missing`、`core-invalid`，权限与 I/O 才进入 `RecordReadError`。
- **身份与关系**：Attempt 永属 origin Run；Member 只引用 Attempt，`origin | reference` 从关系派生，executed/carried/accepted 只属于 actions。expected slots 之外的 Member 由 Sample 标成 invalid，不改写分母。
- **definition**：`defineJsonRecordAttachment` 对 RecordAttachmentName 的 reverse-domain 命名空间、`<name>/vN` schemaId、ASCII case-fold 冲突和路径逃逸逐边界证明。`niceeval.` 前缀与非法 name/schemaId 返回 `Either.left`，没有异常出口。未知但合法的 Attachment 不阻止核心读取。
- **transport**：exact JSON `attachment.json`/`payload.json` 与 owner-local `blobs/**` 各做一次 round-trip。坏 envelope 或坏 payload 形成 `invalid` 并保留 issue；blob closure 的 collection partial 保留为 available 内的事实；未请求 Attachment 不被读取。
- **schema 隔离**：同一 RecordAttachmentName 的已知 schema、未知 schema 与损坏 payload 分别形成 read、unsupported、invalid；一项变化不让整个 Record 失效。旧 schema 的完整相邻 converter 链返回 `migration-required`；命中 `not-losslessly-migratable` 边返回 `migration-unavailable`，两者都不伪造 current value。
- **发布与完成标识**：完整 Run 在最后 exclusive create 零字节 `complete` 前不可读、不可 reuse；完成标识创建后 Run immutable，没有 edit、delete 或补写 API。完成标识前 interruption、I/O failure 或进程退出留下未完成目录，不产生部分 Run。
- **未完成目录**：没有 `complete` 的目录被 reader 忽略并产生 root 级 `incomplete-run` warning；`clean` 取得 writer lock 后重新检查完成标识，并发 writer busy 时返回 busy，已完成的目录跳过不删。
- **外部损坏**：直接修改已发布 Attachment 或 Core 后，下一次 reader 返回局部 `invalid`/`core-invalid`；没有自动修复、revision、history、mirror 或局部 delete 行为。
- **并发边界**：reader 只取 shared maintenance lock；同一 root 的第二个 writer 或 clean 得到 busy，任意 reader 仍可并发。weak reader 可以漏掉刚发布 Run，但不能看见部分 Run；不同 root 不协调、不交换 Member，也不自动合并。

## 不这样测

- 不恢复 head、Graph、旧 Results root、revision、proof、mirror 或 SampleBundle fixture。
- 不把 unknown、missing、unavailable、unsupported、migration-required、migration-unavailable、invalid、partial 和空值折叠成一态。
- 不断言私有目录遍历顺序或实现类名，只断言公开状态、issue、文件可见边界与 bytes。
- 不在单元层复制完整 Report；Record→Reports 的权限、次数与静态导出归 Reports/E2E owner。
