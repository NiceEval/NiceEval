# Record 怎么测

契约出处：

- [Record](../../../feature/record/README.md)
- [Architecture](../../../feature/record/architecture.md)
- [Library](../../../feature/record/library.md)
- [Sample](../../../feature/sample/README.md)

Record 单元层只证明可稳定隔离的格式算法和 reader/writer 边界。真实运行的提交、读取、Reports 接线与用户可见结果由 [E2E · Record 与 Reports 读面](../e2e/report.md)验收。

## Fixture 规范

每例在独立 `mkdtemp` 目录写出最小 `niceeval.record`。fixture 显式给出 Run、expected slot、Member、Attempt identity 和 channel descriptor；builder 不代替测试生成决定结果的身份或默认状态。

大 payload fixture 使用少量真实 bytes 证明 JSONL 与 Attempt-owned blob 边界，不签入巨大黄金目录。目录、JSON 和 JSONL 内容必须从公开形状构造，不能复制 reader 的验证算法作为第二套真相。

## 最小证明面

- **根与导航**：精确根文件可打开；Results 1–15、额外根字段与保留布局冲突得到 root error。Run、Member、Attempt 分别可达 `CoreRead.read`、`missing`、`invalid`，权限与 I/O 才抛 `RecordReadError`。
- **身份与关系**：Attempt 永属 origin Run；`executed`、`carried`、`accepted` Member 只引用 Attempt。expected slots 之外的 Member 由 Sample 标成 invalid，不改写分母。
- **descriptor**：ChannelName、ChannelPath、media type 与 AttemptBlobRef 的长度、字符、prefix、ASCII case-fold 冲突和路径逃逸逐边界证明。未知但合法 channel 不阻止核心读取。
- **transport**：document、JSONL 与 blob 各做一次 round-trip。unknown event 形成 partial decoding；requested invalid 保留 issue；未请求 channel 不被读取。
- **generic fact**：`{ observedAt, value }` 支持任意 JsonValue，同 owner/name 第二次写入是 typed error。以 `JSON.stringify(document)` 的 UTF-8 bytes 验证 65,536 上限、同步拒绝和零部分写入；直接手改超限读为 `ChannelRead.invalid`。
- **原子发布**：Attempt 核心、channels 与 blobs 在一次目录发布前不可见，发布后一起可见。Run 与 Member 的可更新核心使用单文件 atomic replace；正式 Attempt 对 writer 只读。
- **停稳当前值**：目录停稳后人工修改合法 channel，下一次 reader 返回修改后的值。没有 hash、proof、revision、history 或 mirror 行为需要测试。
- **并发边界**：同一 root 的第二项 reader、writer 或 Invocation 得到 `record-root-busy`。export 的 Record 读取/build 阶段按 reader 验收；释放后 execute 和写站不占 lease。不同 root 不协调、不交换 Member，也不自动合并。

## 不这样测

- 不恢复 head、Graph root、Record root、revision、proof、mirror 或 SampleBundle fixture。
- 不把 unknown、missing、unavailable、unsupported、invalid、partial 和空值折叠成一态。
- 不断言私有目录遍历顺序或实现类名，只断言公开状态、issue、文件可见边界与 bytes。
- 不在单元层复制完整 Report；Record→Reports 的权限、次数与静态导出归 Reports/E2E owner。
