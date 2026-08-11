# Record 怎么测

契约出处：

- [Record](../../../feature/record/README.md)
- [Architecture](../../../feature/record/architecture.md)
- [Library](../../../feature/record/library.md)
- [Sample](../../../feature/sample/README.md)

Record 单元层只证明可稳定隔离的格式算法和 reader/writer 边界。真实运行的提交、读取、Reports 接线与用户可见结果由 [E2E · Record 与 Reports 读面](../e2e/report.md)验收。

## Fixture 规范

每例在独立 `mkdtemp` 目录写出最小 `niceeval.record/v1`。fixture 显式给出 Run、expected slot、Member、Attempt identity 和 channel descriptor；builder 不代替测试生成决定结果的身份或默认状态。

大 payload fixture 使用少量真实 bytes 证明 JSONL 与 Attempt-owned blob 边界，不签入巨大黄金目录。目录、JSON 和 JSONL 内容必须从公开形状构造，不能复制 reader 的验证算法作为第二套真相。

## 最小证明面

- **根与导航**：精确 `{ format: "niceeval.record/v1", recordId }` 可打开；旧 Results、额外根字段与保留布局冲突得到 root error。Run、Member、Attempt 分别可达 `CoreRead.read`、`missing`、`invalid`，权限与 I/O 才进入 `RecordReadError`。
- **身份与关系**：Attempt 永属 origin Run；`executed`、`carried`、`accepted` Member 只引用 Attempt。expected slots 之外的 Member 由 Sample 标成 invalid，不改写分母。
- **descriptor**：ChannelName、ChannelPath、media type 与 AttemptBlobRef 的长度、字符、prefix、ASCII case-fold 冲突和路径逃逸逐边界证明。未知但合法 channel 不阻止核心读取。
- **transport**：document、JSONL 与 blob 各做一次 round-trip。unknown event 形成 partial decoding；requested invalid 保留 issue；未请求 channel 不被读取。
- **schema 隔离**：同一 ChannelName 的已知 schema、未知 schema 与损坏 payload 分别形成 read、unsupported、invalid；一项变化不让整个 Record 失效。execution-required eligibility 另验 `reuseContract` domain mismatch 必为 gap。
- **原子发布**：完整 Run 的核心、Members、origin-owned Attempts、channels 与 blobs 在一次目录 publish 前不可见，发布后一起可见且不可修改。source/destination/manifest 的 crash matrix 每个组合都有唯一 fail-closed 结果。
- **外部损坏**：直接修改已发布 channel 或 core 后，下一次 reader 返回局部 `invalid`；没有自动修复、revision、history、mirror 或局部 delete 行为。
- **并发边界**：同一 root 的第二个 writer 或 recovery 得到 `record-writer-busy`，任意 reader 仍可并发。weak reader 可以漏掉刚发布 Run，但不能看见部分 Run；不同 root 不协调、不交换 Member，也不自动合并。

## 不这样测

- 不恢复 head、Graph root、Record root、revision、proof、mirror 或 SampleBundle fixture。
- 不把 unknown、missing、unavailable、unsupported、invalid、partial 和空值折叠成一态。
- 不断言私有目录遍历顺序或实现类名，只断言公开状态、issue、文件可见边界与 bytes。
- 不在单元层复制完整 Report；Record→Reports 的权限、次数与静态导出归 Reports/E2E owner。
