# 审计拥有费用

为现有 chat、TypeSafe、image 审计发布各自后继版本，在每次 attempted transmission 内增加 token、费用和白名单回执。
调用 identity 是 origin Attempt、entryIndex、logicalOrdinal、transmissionOrdinal；只按此去重。

另在 Attempt 发布包含所有受管 entryIndex 的完整性 manifest，包括零调用 entry；旧 Record没有 manifest 保持未知。
读取端必须解码所有这些审计并验证 manifest，每个审计的预算或引用错误都会令裁判统计不完整。

价格只来自显式配置并在审计内封存 selector/rates/digest；reported zero 优先。
不保留任意 HTTP 错误正文；只取协议允许的 token/费用字段。取消与非成功响应也更新当前审计。

预算在传输前预留最坏费用回执空间。材料、文字理由、模型输出和用量共用审计生命周期。
超预算的步骤拒绝发送；封存后迟到回包不允许改写。任一审计失败需要从 manifest 保留其费用缺口。

本候选需要扩大三个审计协议及多处读取路径。由于完整性 manifest 仍不可省略，并未消除 Attempt 所属的新状态。
费用读取还必须读取大量与金额无关的材料，比独立账本更容易受到审计预算和内容读取故障影响。
