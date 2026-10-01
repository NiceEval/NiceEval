# Decision

## 定案

Selected: [plan-1](plans/plan-1/README.md)

## 依据

采用普通 Adapter 的命名模型用途切片。阶段一包括配置、物理关联、全账本统计与 Show/View，Judge 与 Agent 多模型执行后置。
应用成本维持既有口径；Judge unavailable，合计只给带缺口的已知金额。

G2: 阶段一仅有应用物理账本；Judge 明示不可用，合计保留缺口。完整 Judge 费用后置，不伪造总金额。

实际模型分组无法区分共享模型的用途，也无法表达实验只修改一个用途。必须保存配置意图和调用事实两份不同含义的数据。
复用物理 callId、reported cost 与封存价格证据，无需复制应用 journal。单模型简写只归一到同一 default 配置，不形成另一套执行语义。

GPT-6 Astra 独立审查的四项 P1 已修订：默认归一、Agent 粒度边界、origin 持久身份、正式读取与费用缺口。
定点复核再指出预览缺席不能证明未调用，现以配置行的全账本 recordedCalls 解决；129/1/0 反例进入 C9。
审查判断允许修正后分派阶段一实现，未以源码或文档检查代替公开验收。

## 否决项

[plan-2](plans/plan-2/README.md) 只能改善实际模型汇总，无法表达配置用途和未调用用途，不足以完成本次消费者目标。
不采用把模型名拼接、把 transport 当 serving provider、把成功 Judge 审计解码成完整费用账本的替代方案。

## 遗留风险

Judge 失败 HTTP body 与物理用量尚无完整账本，阶段一明确 unavailable。Agent reported-sends 不进入实际物理分组。
旧 Record 不补用途或价格。费用 selector 仍按模型字符串，未承诺独立 serving provider 定价。
