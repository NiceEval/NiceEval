**相关文档**：[README](README.md) · [Limits](LIMITS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

# Goals

## 目的与范围

本决策选择 Record Host 的 Run 内物理存储形态。
它只处理 staging、item/Content 的有界写入、索引、校验、publication 与 storage migration。

它不重新设计 family 的业务字段、Analysis、Report、跨 Run selection 或远端服务。
它也不把 physical chunk、path、SQL、object key 或 transaction 暴露给业务作者。

## 设计原则

| ID | 目标 |
|---|---|
| G1 | business definition 只声明 logical value、plain-data collection item、Content 与 reference；Host 独占物理策略 |
| G2 | 一个逻辑 Content 的峰值内存由有界 buffer 决定，不随 Content 总长度线性增长 |
| G3 | Attempt Record collection 可以跨多次 send 增量写入 staging，不在 Attempt 进程内保留完整 item 数组 |
| G4 | published Run 是 immutable self-contained closure；复制完整 Record root 后无需外部数据库、cache 或 bucket |
| G5 | publication 在崩溃前后保持 fail closed；reader 只接受不可见或通过目标强度校验的 Run |
| G6 | ordinary read 只加载请求的 family closure；Content 在调用方实际消费时读取 |
| G7 | `requireComplete()`、publish 与 migration 可以验证完整 Core、Attachment、Content、reference 与 Seal inventory |
| G8 | 不同 Run 可以并行写入；同 Run 的并发 Attempt 不把 scheduler 顺序误写成业务顺序 |
| G9 | unknown family 可以按通用 inventory 与原 bytes 保存、复制和迁移，不要求 Core 理解业务 Schema |
| G10 | 改变 inline、pack、segment 或 database page 策略只提高 storage revision，不推动 family revision |
| G11 | hostile durable bytes 受到有界 CPU、内存、深度、长度、数量与 schema surface 限制 |

## 可验证要求

- [Cases](CASES.md) 为所有候选提供相同输入与验收结果。
- 每个 PLAN 必须给出作者调用面、物理数据模型、完整生命周期、错误语义与 Case 兑现路径。
- 任一候选必须给出 crash fault points、unknown-family 路径和 storage migration 路径。
- 候选不能用未来的 public item pagination、跨 Run CAS 或后台服务证明本轮收益。
