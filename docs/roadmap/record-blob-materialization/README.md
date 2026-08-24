# Record blob 透明分段与存取

Attachment producer 需要保存大材料时，只应提交一个逻辑 blob 及其 byte stream。
它不应为了 Record 的物理限制切分 payload、复制语义文档，或向作者暴露 chunk、manifest 与存储布局。
本方向把大 blob 的流式写入、物理分段、完整性校验和 Attachment 内去重收归 Record Host。

## 核心心智

Record content 是 Attachment 拥有的一段逻辑 bytes，而不是单个磁盘文件或一组公开 chunk。
producer 声明逻辑材料，Record Host 决定怎样写入和保存；reader 仍读取一条连续且经过验证的逻辑 stream。

payload 中的 sealed `RecordContentHandle` 始终表示逻辑 content；它不携带 path、digest 或物理位置。
物理 segment、manifest、临时写入与去重索引只属于 Record Host，不进入 Eval、Assertion、Analysis、Report 或用户配置。
复制一个 Attachment closure 时，它依赖的全部物理 bytes 必须随 closure 一起移动。

## 范围

本方向包含：

- 有界内存的逻辑 blob 流式写入与读取；
- Record Host 私有的物理分段和重组；
- 每个逻辑 blob 的总长度与整体 digest 校验；
- segment 与 manifest 的完整性校验；
- 同一 Attachment closure 内重复内容的透明去重；
- 中断、空间不足、损坏和迁移时的原子发布与具名错误。

本方向不增加 chunk size、segment ID、manifest path、去重开关或存储策略等公开 API。
它不允许跨 Attachment 借用 content handle，也不建立依赖全局对象库才能独立复制的 Record。
它不改变 payload JSON 的 family 预算；大材料进入 blob 不是绕过 Attachment 总预算与安全上限的手段。

## 用户可观察边界

作者仍只提交逻辑 snapshot、artifact 或其它 family material。
材料达到 family 的外置条件时，family producer 可以生成逻辑 blob，但不负责决定物理分段。
CLI 与 Report 只呈现材料状态、逻辑 byte length、整体 digest、preview 与业务 limitation。

物理 segment 数量、边界和复用情况不影响 Assertion result、Score、Gate、cache identity 或 Report 输出。
只要逻辑 bytes 相同，改变 Record Host 的分段与存储策略不能形成新的用户事实。

## 采用前挑战门

本方向晋升为 Feature 前，必须通过一次独立重大设计挑战。
挑战应比较单文件流、固定尺寸分段、内容定义分段和存储层透明分段，并以共同案例验证候选。

挑战必须证明以下性质，而不是仅证明正常路径能够读回：

- producer 和 reader 的峰值内存不随逻辑 blob 总长度线性增长；
- 任意 segment 写入点被中断后，不会出现可见的半封口 Attachment；
- manifest、segment、整体 digest 和 byte length 的任一损坏都被 closure 校验拒绝；
- 去重不会形成跨 owner capability、secret existence oracle 或删除时的引用悬挂；
- Record 整体复制、未知 family 保留、maintenance 与相邻 schema migration 仍有确定语义；
- 现有 producer、Analysis 和 Report 无需理解或分支处理物理分段。

无法同时满足这些性质的候选不得进入当前 Record 契约。
物理 wire layout、segment 边界算法和 migration shape 在该挑战中定案，不在本 Roadmap 方向提前固化。

## 入口

- [Architecture](architecture.md) —— owner、数据流、不变量和失败边界。
- [当前 Record Architecture](../../feature/record/architecture.md) —— 现行 Attachment closure、sealed content 与发布状态机。
