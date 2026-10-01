# Limits

## L1: 既有运行边界

受管 ScoreMatch 的所有模型原语走同一个 HTTP 函数。每个逻辑步骤最多三次传输，失败正文不依赖评分审计保存。
Assertion runtime 属于 Attempt，root、Session、Turn 共享它；纯 Match、空材料和提前拒绝可以零调用结束。

## L2: 持久读取

Record 使用 Attempt 附件 family、明确 revision 和 publication cut。现有应用 usage v1/v2/v3 及费用口径已有真实消费者。
单 Attempt 用量查询存在 512 KiB 输出预算，完整实验结果上限为 4 MiB，调用与模型组已有预览上限。旧 Record没有 Judge 账本，不能从缺席推导零。

## L3: 费用事实

Provider 类型描述接入协议，不能自动当作真实 serving provider。现有价格配置按模型字符串 exact 或前缀匹配。
用户提供的 Vercel 本地 fixture 已发出一次请求，回执有输入 120、输出 30，当前候选仍报告 Judge 未登记。

### 候选

- [Plan 1](plans/plan-1/README.md)：Attempt 独立账本，在传输边界登记。
- [Plan 2](plans/plan-2/README.md)：在 Assertion 审计内封存，再由读取端汇总。
