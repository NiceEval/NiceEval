# Record blob 透明分段与存取 —— Architecture

## 数据建模

逻辑模型保持 `Attachment → RecordBlobRef → logical bytes`。
Record Host 可以把 logical bytes 写成一个或多个私有 segment，但 segment 不是 Attachment payload entity。

```text
Attachment payload
  └─ RecordBlobRef ──> LogicalBlob
                         ├─ byteLength
                         ├─ sha256
                         └─ ordered private loading
                              ├─ manifest
                              └─ segment bytes
```

`RecordBlobRef` 的身份域仍是 owner 与 family。
两个逻辑 ref 即使内容相同，也不能互换 owner capability。
Record Host 可以在同一 Attachment closure 内让它们复用私有 bytes，但 reader 仍按各自逻辑 ref 验证和授权。

manifest 是 Record Host 的物理实现事实，不是 Analysis input。
它至少足以验证 segment 顺序、每段完整性、逻辑 byte length 与整体 SHA-256。
具体字段、编码、segment 边界和文件布局由采用前设计挑战定案。

## 写入数据流

1. family producer 向 Record Host 提交逻辑 blob source，不预先拼成 payload 内联 JSON。
2. Record Host 增量读取 source，同时计算整体 byte length 与 SHA-256。
3. Host 按私有分段策略写入 staging segment，并建立 staging manifest。
4. Host 在 Attachment 作用域内查找可安全复用的相同内容，不把复用关系扩大到其它 owner。
5. 所有逻辑 ref、manifest、segment 和 payload 通过 closure 校验后，Host 才发布 Attachment。
6. 中断或失败时，Host 删除 staging bytes 并释放打开的 handle；没有完整 closure 的 bytes 不成为 Record 事实。

producer 提供的预期长度或 digest 只能作为校验输入，不能替代 Host 对实际 stream 的计算。
长度或 digest 不一致时，发布失败并指出逻辑 blob，不回退成截断成功。

## 读取数据流

1. Record Host 解码 payload 中的逻辑 `RecordBlobRef`。
2. Host 验证该 ref 属于当前 owner、family 和完整 closure。
3. Host 按 manifest 顺序惰性读取 segment，并验证每段完整性。
4. Host 对重组 stream 验证总长度与整体 digest。
5. 上层只接收连续的逻辑 stream、逻辑 metadata 或具名失败。

Analysis 与 Report 不取得 manifest 或 segment handle。
调用方取消读取时，Record Host 关闭全部文件和 Scope；取消不改变已封口 Record。

## 不变量

- 物理分段不得出现在作者 API、family payload schema或 Analysis domain model。
- 一个逻辑 ref 只授权读取所属 Attachment closure 中的一条逻辑 bytes stream。
- 分段和去重不改变逻辑 byte order、byte length、digest 或 family 语义。
- 同一 Attachment closure 可以独立复制、校验和读取，不依赖外部对象库。
- payload JSON、逻辑 blob、物理 segment 和整个 Attachment 各自保留明确预算。
- 超出预算是具名失败或 family 定义的业务 limitation，不是静默丢 segment。
- 删除一个 Attachment 不影响其它 Attachment 的可读性。
- 未认识该 segment 存储格式的 reader 按 Record schema 兼容规则处理，不猜测磁盘布局。

## 生命周期与错误

Record Host 拥有 source consumption、staging、segment handle、manifest、closure validation 与 cleanup。
family producer 只拥有逻辑材料的形成过程，不能直接创建 segment 或发布 manifest。

失败至少区分 source 读取失败、预算超限、空间不足、digest 不一致、segment 写入失败、manifest 无效、closure 不完整和读取期损坏。
错误对用户说明受影响的逻辑 blob 与下一步，但不泄漏私有 path、segment key 或物理布局。

## 身份与复用

cache 与 Analysis identity 只使用 family 已声明的逻辑事实。
segment 大小、segment digest 列表、压缩方式和 Attachment 内复用计划都不进入 Experiment、Eval、Attempt 或 Assertion identity。

相同逻辑 bytes 可以在同一 Attachment closure 内复用物理存储。
复用索引不能跨 Attachment 建立生命周期依赖，也不能让一个 owner 通过命中结果推断另一个 owner 是否保存过相同 secret。
