# Cases

| Case ID | 输入 | 验收结果 |
| --- | --- | --- |
| C1 | 新 Attempt，无 Judge 或完整空材料 | 物理调用 0；Judge 没有费用缺口；不制造 USD 0 回执 |
| C2 | 一次成功，120 输入、30 输出，无费用 | 1 次、150 token；费用 unavailable，总计 partial |
| C3 | 503 带 USD 0.01，重试成功带 USD 0 | 2 次；保留两条回执，费用 complete 0.01；成功数不替代物理数 |
| C4 | 超时、断连或失败正文无 usage | 已启动传输保留，token/cost 未知；不补零 |
| C5 | 非法 QA 内容但有效 usage/cost | QA errored，费用仍完整；业务解码不丢回执 |
| C6 | 调用前取消、凭据缺失或账本容量拒绝 | 未进入 HTTP 的步骤不计调用，不执行 provider |
| C7 | 显式 pricing 与 reported zero 并存 | reported zero 优先；缺费用才使用封存估价，不从在线目录补价 |
| C8 | 两 Attempt、多个 Assertion、多次逻辑步骤 | 身份不混淆；引用 origin 不重复，预览截断不改变总量 |
| C9 | 旧 Record、附件损坏、不同币种 | 旧 Judge 未知；损坏明确 invalid；币种分别合计 |
| C10 | Agent 与普通 Adapter 分别执行相同 Judge | 账本语义相同，应用用量不混入裁判 |
| C11 | 非成功或过大响应、中断后迟到回包 | 已发送计数保留；有界读取，封存后不变更账本，无凭据泄漏 |
