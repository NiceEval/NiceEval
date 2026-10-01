# Handle 追加评分 —— Architecture

新增 collection registrar 返回可转换 entry。

第一次调用登记存在性，judge 修改该 entry 的 evaluator、criterion 与类型。


消费者不执行 evaluator。

collection owner 逐候选执行同一 Boolean evaluator，and 只比较同一事实。


保留原 subject 快照，评分必须穷尽且完整；unknown 不调用模型，完整零匹配 measurement 为 0。



受管 gateway 仍持有预算、原语、取消和审计，转换不能新建 runtime 或 durable family。


工具/事件从原 sidecar 获取证据，不能用公开投影替代 partial 语义。


模型实际输入、子评分定义与 collection receipt 保存到同一 entry，函数本身不持久化。



类型引入第三类 handle 并阻止 Boolean gate 与 measurement gate 混用；已配置策略后转换同步拒绝。


风险是登记后存在一个未定 evaluator 阶段，需要保证 collector 不在 judge 前启动原 Boolean 求值。


验收测试涉及范围 same-event、零请求、unknown、快照、单次转换、未转换存在性、取消与 sealed entry 防写。
