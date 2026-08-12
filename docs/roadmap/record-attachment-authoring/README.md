# RecordAttachment 作者 SDK

用户、Plugin 与 NiceEval 内建 producer 都需要保存运行时才知道的事实。它们共享同一个
`RecordAttachment` 作者模型，不为简单 JSON、Plugin 或官方事实各建一套持久 primitive。

## 核心心智

`defineRecordAttachment()` 一次声明一个完整 family：owner、全部 schema 版本、current 版本、blob ref
projection，以及每条相邻 migration。family 拥有 migration 能力；应用只决定是否安装并信任它。

同一个 opaque definition 参与三种彼此独立的绑定：

```text
RecordAttachmentDefinition（版本与 migration 的 owner）
  ├─ producer allowlist     → 谁能在当前 Run / Attempt 写
  ├─ application registry   → 当前应用为读取与 migrate 安装并信任哪些 definition
  └─ reuse requirement      → carry 是否要求 current Attachment available

AttemptRecordContext / RunRecordContext → 实际、owner-local、带生命周期的写入 authority
```

definition 本身不授权写入。producer 获得写权限也不会把 converter 隐式安装到 CLI；安装 definition
同样不会允许任意 producer 写入。

## 范围

本方向包含：

- 一个对象内的多版本 definition 与 attachment-owned migration 图；
- Eval、Experiment、Plugin 和内建 producer 共用的 allowlist；
- `AttemptRecordContext` 与 `RunRecordContext` 上同形的 `record()`；
- `defineConfig({ recordAttachments })` 形成的显式 application registry；
- `niceeval migrate` 对已安装 definition 的显式迁移。

它不改变 Record Core、磁盘 layout、owner-local blob closure、完成标识、锁或 migration sentinel。
Projection、Relations、Calculation 与 Report 仍在上层定义。schema identity 不代替 producer behavior
identity，也不自动决定 reuse。

`RecordAttachment` 是唯一 durable primitive。简单 JSON 只是零 blob closure 的调用形状，不建立独立
Channel identity、registry、projector 或 migration 机制。

## 入口

- [Library](library.md) —— definition、producer allowlist、写入 context 与 migration callback。
- [Architecture](architecture.md) —— 四层 authority、family-owned migration 与官方无特权边界。
- [Lifecycle](lifecycle.md) —— reserve、并发、封口、失败与中断。
- [CLI](cli.md) —— application registry、plan、Git 恢复点与 migrate 反馈。
- [Use Case](use-case/README.md) —— 自定义事实与版本演进的完整路径。
