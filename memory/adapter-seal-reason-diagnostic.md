# sealUsage 的非法 reason 缺少可操作的调用处错误

sealUsage 已同步拒绝非法封存输入，但只抛出 Invalid Adapter usage seal。调用方无法从错误得知 reason 只能使用有界 ASCII 标识。

要求错误明确 1–128 字符、首字符字母或数字、允许字符集合，并保留采集失败状态与此前已登记用量。公开 Adapter E2E 中捕获错误后，用正常断言验证诊断；Attempt 仍须 errored，usage 保留已接纳调用。
