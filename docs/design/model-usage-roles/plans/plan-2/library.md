# 调用面

作者保持现有 Experiment.model 与 recordUsage，不新增字段。
Inspection 返回按实际 provider/model 分组的调用数、token 与费用完整度。
配置仍只显示已登记的单模型，不把应用 flags 解释成正式模型配置。
应用和 Judge 分列及总计仍需要框架提供，不能由消费者相加预览行。
