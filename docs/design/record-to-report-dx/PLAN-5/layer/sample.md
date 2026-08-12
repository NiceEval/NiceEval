# Sample 子设计

**上游**：frozen Record view · **下游**：[Projection](projection.md) ·
**API 单源**：[Library](../library.md)

Sample 回答“这次分析包含哪些位置”，不回答“这些位置的业务事实是什么”。它先于
所有 package I/O 建立稳定 population，防止缺失或损坏的 Attachment 从分母中消失。

## 拥有的契约

Sample 拥有 selected Runs、logical slot universe、selection reasons 与 exact owner resolution。每个 slot
穷尽处于 included、excluded、not-recorded 或 core-invalid。Included slot 同时保留 selected Run、
origin Run 和 exact Attempt ref，不用“当前 Run”默认值猜 owner。

Sample handle 绑定 reader-owned frozen view identity 与不可伪造的 view token。后续 Projection 与
Relations 通过该 token 证明所有输入来自同一 snapshot 和 population。

## 不拥有的责任

- 不读取业务 package、blob closure 或 Capture Receipt。
- 不执行 migration、projector、cross-package join 或 metric。
- 不根据 available Attachments 反推 population。
- 不替 Report 选择“latest” grading claim。

## DX 与生命周期

普通作者只提供显式 Run selection 和可选 grading claim selection。Host 打开一个 scoped frozen
view，建立 Sample handle，并在整次 execution 结束时关闭它。同一 handle 可执行多组 projections；
另一 selection 必须建立新 Sample。

Core I/O、permission、invalid reference 或 interruption 是 Sample 建立失败。Slot 本身的 excluded、
not-recorded 与 core-invalid 是成功结果中的数据，不是 throw。

## 验收条件

- Reference Member 保留 selected Run 的 slot 位置，同时把 package owner 定位到 origin Attempt。
- 两个 slots 引用同一 Attempt 时，分母仍保留两个 logical positions。
- 任何 package unavailable 或 invalid 都不会删除 slot。
- 两个 frozen views 的 results 不能被后续层混用。
