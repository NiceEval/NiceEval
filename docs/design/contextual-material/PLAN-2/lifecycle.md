# 材料 reader 绑定 —— Lifecycle

声明期创建材料工厂 token。每个 Attempt 创建材料 reader 表，Adapter create 完成后组装 assertions 并绑定 reader。
组装完成后开放应用读取；每次 check/closeQA 调用查表和捕获材料。
Seal 运行单项 predicate，完整非空 QA 由受管 Judge 评分。
Cancel 关闭材料 reader 表、取消 Judge 并固定收据；cleanup 清空 reader 引用。

材料 reader 表不跨 Attempt 复用。未绑定、重复 token 或重入读取在登记处失败。
不存在镜像或 sandbox 起点选择；应用资源沿用 Adapter 生命周期。
