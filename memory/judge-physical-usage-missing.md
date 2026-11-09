# Judge 已发送请求未进入官方用量与费用读面

RPG 消费者使用候选 b65a4ebe，通过公开 exp、closeQA 和本地 VercelProvider HTTP fixture 发出一次 chat/completions 请求。响应包含 prompt 120、output 30、total 150，QA passed；attempt.usage 仍返回 judge-usage-not-recorded。消费者保留原 SQLite、HTTP 和 Show 输出，未使用付费模型。

源码根因是受管 Judge 仅记录评分审计，缺少 Attempt 所属物理用量账本；Inspection 固定返回 Judge unavailable。非成功 HTTP 正文也未进入账本，无法从成功审计补全失败和重试费用。

契约见 [Judge 物理调用与费用](../docs/feature/judge/architecture.md#judge-物理用量账本)。修复须在安装候选的公开 HTTP/CLI 路径验证无调用、成功/失败/重试、已知零、未知、显式估价、取消和历史缺源。应用费用口径保持独立。

当前实现用独立 Judge family 记录实际 HTTP 传输，在判分解码前接纳用量回执；失败与重试不由业务 Verdict 推断。正式回归 judge-usage-tokens 取得缺失持久连接的最小逆补丁红灯与完整可靠性证明。无调用、失败重试、显式估价及已知零另由公开 CLI 场景验收，Vercel Chat 未证明的费用和 cache-write 保持未知。
