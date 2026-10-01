# 审计登记与汇总

Attempt 建立受管 Assertion manifest。Assertion 登记即写入其 entryIndex，未发送步骤也在 manifest 内。
每次 HTTP 前在审计增加 attempted 项，收到回执后先保留费用，再解码评分输出；重试增加新的 transmission ordinal。
终态关闭全部审计 producer，再封存 manifest。Query 按 manifest 读取全部审计，合计已知数量和币种金额。

任何缺失或损坏审计使结果 partial；旧 Record缺 manifest 为 unavailable。完整空 manifest 才能证明没有 Judge 调用。
取消、迟到结果、边界超限与原审计资源生命周期一致；不从失败的业务结果推导收费为零。
