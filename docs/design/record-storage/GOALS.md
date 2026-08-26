**相关文档**：[README](README.md) · [Limits](LIMITS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

# Goals

## 目的与范围

本决策选择 Record Host 的物理存储形态。
它处理 staging、item/Content 的有界写入、索引、校验、publication、storage migration，以及 project Record 与 OS-user Service state 的资源边界。

它不重新设计 family 的业务字段、运行后 Inspection Operations、跨 Run selection 或远端服务。
它也不把 physical chunk、path、SQL、object key 或 transaction 暴露给业务作者。

## 当前性能边界

本设计要求 50,000 个 collection item 与合计 144 MiB Content 的完整功能路径可以 write、seal、stream read 和验证。
当前不为 heap、RSS、latency、throughput 或 Record/Snapshot size 设 performance SLO。Stream API 与 bounded batch 规定的是增量
处理、资源生命周期和正确性边界；性能优化及其量化目标留待后续裁决。

## 设计原则

| ID | 目标 |
|---|---|
| G1 | business definition 只声明 logical value、plain-data collection item、Content 与 reference；Host 独占物理策略 |
| G2 | rich write 与流式读取通过 Stream 增量处理 logical Content；buffer、descriptor 与 physical chunk policy 保持 Host 私有 |
| G3 | Attempt Record collection 可以跨多次 send 增量写入 staging，不在 Attempt 进程内形成 collection value；Host 以 bounded batch 接纳并施加 backpressure |
| G4 | sealed Run 的 closure 全部位于同一 project Record store；可搬运的 `RecordSnapshot` 由 Host 显式形成且自包含，不需要外部 database、cache 或 bucket；Git 是常见运输方式，不是 validity 条件 |
| G5 | publication 在崩溃前后保持 fail closed；reader 只接受不可见或通过目标强度校验的 Run |
| G6 | ordinary read 只加载请求的 family closure；Content 在调用方实际消费时读取 |
| G7 | `requireComplete()`、publish 与 migration 流式、可取消地验证完整 Core、Attachment、Content、reference 与 Seal inventory |
| G8 | 不同 Run 与同 Run 的并发 Attempt 都能持续取得写入进展；物理事务可以序列化，但不能饥饿、死锁或把 scheduler 顺序误写成业务顺序 |
| G9 | unknown family 可以按通用 inventory 与原 bytes 保存、复制和迁移，不要求 Core 理解业务 Schema |
| G10 | 改变 inline、pack、segment 或 database page 策略只提高 storage revision，不推动 family revision |
| G11 | hostile durable bytes 在 decode 或遍历前受到结构 ceiling；全量验证的总工作可以随 closure 增长，但必须可取消并给出具名资源 failure |
| G12 | Core 不为单 Content、Attachment Content 合计或 Run Content 合计设置固定 byte cap；producer 不为扩大容量手工拆 family 或 part |
| G13 | `text` / `bytes` 便利入口不改变 Content validity；整体读取因本机资源被拒绝时，reader 保持 available 并提示使用 `stream` |
| G14 | physical member、database page、chunk、index 与 Seal grouping 保持 Host 私有；候选可以使用单 application file 或 rollover，只要不引入 NiceEval 领域 byte cap，并通过共同的大规模功能、完整性与资源失败 Cases |
| G15 | project Record、OS-user Service state、cache、secret 与 coordination 是不同资源类别；共享 Store Host 可以统一 connection、transaction、worker 与 migration authority，但不能合并它们的 portability 或 validity |
| G16 | 第一方 Service 可以贡献 namespaced schema revision、相邻 migration、固定 operation 与 typed decoder；Service 不取得 raw connection，也不能跨 namespace 读写或在外部等待期间持有 transaction |

## 可验证要求

- [Cases](CASES.md) 为所有候选提供相同输入与验收结果。
- 每个 PLAN 必须给出作者调用面、物理数据模型、完整生命周期、错误语义与 Case 兑现路径。
- 任一候选必须给出 crash fault points、unknown-family 路径和 storage migration 路径。
- 候选不能用未来的 public item pagination、跨 Run CAS 或后台服务证明本轮收益。
