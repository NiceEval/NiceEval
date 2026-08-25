# Record blob 透明分段与存取 —— Architecture

## 数据建模

逻辑模型保持 `Attachment → RecordContentHandle → logical bytes`。
Record Host 可以把 logical bytes 写成一个或多个私有 segment，但 segment 不是 Attachment payload entity。

```text
Attachment payload
  └─ RecordContentHandle ──> LogicalContent
                         ├─ byteLength
                         ├─ sha256
                         └─ authenticated private byte storage
                              ├─ small root
                              ├─ rolling handle catalog
                              ├─ rolling range index
                              └─ rolling segment packs
```

`RecordContentHandle` 的身份域仍是一次 owner Session 的 Attachment write。
两个逻辑 handle 即使内容相同，也不能互换 capability。
第一版 storage revision 为每个 logical handle 独立保存私有 bytes，并按各自 handle 验证和授权。

root、catalog、index 与 segment pack 是 Record Host 的物理实现事实，不是 Analysis input。
它们至少足以验证 handle identity、range 顺序、每段完整性、逻辑 byte length 与整体 SHA-256。
具体字段、编码、segment 边界和文件布局由采用前设计挑战定案。

## 写入数据流

1. family producer 通过 Session builder 提交逻辑 content source，不预先拼成 payload 内联 JSON。
2. Record Host 增量读取 source，同时计算整体 byte length 与 SHA-256。
3. Host 按私有分段策略写入 staging segment，并滚动建立 range index、handle catalog 与小 root。
4. Host 为当前 handle 完成独立 range closure；第一版不执行内容命中查询或复用其它 handle 的 ranges。
5. 所有逻辑 ref、root、catalog/index pages、segment 和 payload 通过 closure 校验后，Host 才发布 Attachment。
6. 中断或失败时，Host 删除 staging bytes 并释放打开的 handle；没有完整 closure 的 bytes 不成为 Record 事实。

producer 提供的预期长度或 digest 只能作为校验输入，不能替代 Host 对实际 stream 的计算。
长度或 digest 不一致时，发布失败并指出逻辑 blob，不回退成截断成功。

## 读取数据流

1. Record Host 解码 payload 中的 sealed `RecordContentHandle`。
2. Host 验证该 handle 属于当前 owner、family 和完整 closure。
3. Host 按 authenticated range pages顺序惰性读取 segment，并验证每段完整性。
4. Host 对重组 stream 验证总长度与整体 digest。
5. 上层只接收连续的逻辑 stream、logical byteLength 或具名失败。

Analysis 与 Report 不取得 manifest 或 segment handle。
调用方取消读取时，Record Host 关闭全部文件和 Scope；取消不改变已封口 Record。

## 不变量

- 物理分段不得出现在作者 API、family payload schema或 Analysis domain model。
- 一个逻辑 handle 只授权读取所属 Attachment closure 中的一条逻辑 bytes stream。
- 分段不改变逻辑 byte order、byte length、digest 或 family 语义。
- 同一 Attachment closure 可以独立复制、校验和读取，不依赖外部对象库。
- Core 不对 logical Content 或其 Attachment/Run 合计设置 byte cap；payload JSON 与 storage structure仍有明确 ceiling。
- family `maximumBytes` 是领域写入约束；超过它是具名失败，不是 storage 保护，也不静默丢 segment。
- data、range index、handle catalog 与 Seal inventory分别 rollover；一个巨大 metadata文件不能替代旧 Content cap。
- 删除一个 Attachment 不影响其它 Attachment 的可读性。
- 未认识该 segment 存储格式的 reader 按 Record schema 兼容规则处理，不猜测磁盘布局。

## 生命周期与错误

Record Host 拥有 source consumption、staging、segment handle、manifest、closure validation 与 cleanup。
family producer 只拥有逻辑材料的形成过程，不能直接创建 segment 或发布 manifest。

失败至少区分 source/family value、storage structure、published corruption、whole-value read admission、I/O resource 与 publication。
`text` / `bytes` 因内存 admission被拒绝时，Record 仍然 valid；digest、缺失、额外或截断才是 corruption。
错误对用户说明受影响的逻辑 blob 与下一步，但不泄漏私有 path、segment key 或物理布局。

## 身份与未来复用

cache 与 Analysis identity 只使用 family 已声明的逻辑事实。
segment 大小、segment digest 列表与压缩方式都不进入 Experiment、Eval、Attempt 或 Assertion identity。

第一版不复用相同 logical bytes，也不建立内容命中索引。
未来 storage revision 若引入复用，必须另行挑战；它不能跨 Attachment 建立生命周期依赖，也不能让一个 owner 通过命中结果推断另一个 owner 是否保存过相同 secret。
