# Limits

## L1: 现有物理调用边界

AdapterUsageInput 已有 callId、retryOf、provider、model、route、status、token 桶与 reported cost。
provider 是上游证明的 serving provider；route 是传输身份。缺项不能从 model 名推断。
现有显式价格按 model 字符串或其命名空间 wildcard 选择，并非独立 provider/model 二元匹配。

## L2: 当前配置与读取

Experiment.model 与 AdapterCreateContext.model 是单值。Run 配置模型列不从调用账本反推。
attempt.usage 返回最多 128 个调用的预览，聚合包含全部已封存调用。没有用途字段或按用途分组。

## L3: 独立成本账本

Adapter 调用账本与托管 Judge 审计有独立身份和生命周期。现有 Judge 审计不等于完整物理计费账本。
旧 Record 不具备的调用或费用事实不能从新配置补造。运行中的统计必须固定 cut。

## L4: 验收与权限

消费者用离线正式归档验收，不运行付费模型。框架不认识 NPC、游戏槽位名或 journal 结构。

### 候选

- [plan-1](plans/plan-1/README.md)：计划模型用途与实际调用显式关联。
- [plan-2](plans/plan-2/README.md)：只按已上报的实际模型汇总，不引入配置用途。
