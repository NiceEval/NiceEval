# 调用与费用读取

作者继续使用现有 Judge，应用不登记裁判用量。Query 从 Assertion 审计返回裁判 requests、token、逐币种费用和缺项。
每次传输有 entryIndex、logicalOrdinal、transmissionOrdinal，保留成功、失败、取消和未知结果。
明确零金额优先于估价；没有费用回执则未知，旧 Record没有完整性 manifest 时同样未知。

应用 costUSD 独立；总成本逐币种累加已知小计，任一应用或裁判缺项使总成本 partial。
Show 与 View 复用 Query；无调用需要完整 manifest 及全部审计核对，不能仅因没有可见成功步骤显示零。
公开预览最多 128 调用，总量从全部审计计算。未发送步骤不计物理调用。
