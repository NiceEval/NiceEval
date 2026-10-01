# 材料 reader 绑定 —— Architecture

每个 Assertion runtime 拥有材料工厂 token 到 reader 的表。
Adapter assertions factory 在事务内声明绑定，成功组装后一次提交，失败回滚。
selector 仅引用 token 和 predicate，登记时从表取得 reader，复制集合并执行原有单项 evaluator。
材料工厂名称和 token 在同一 Attempt 唯一，跨 Attempt 未绑定的 token 拒绝。

完整性在过滤前保存。普通存在性有见证可通过；整组 QA 需要完整集合与全量确定性筛选。
完整空集零分零调用，partial、未知及容量超限不可判定。
所有材料保序，不成功抽样；受管 gateway 承担预算、取消、usage 与引用校验。

类型不携带应用 ctx，业务 read 闭包捕获 factory 的 app。
统计分别保持 Adapter 物理请求账本与 Agent turn 汇总，额外 snapshot 方法提供 Adapter 的统计。
这保留原作者形状，却无法统一统计入口并增加材料工厂声明与绑定两步。
