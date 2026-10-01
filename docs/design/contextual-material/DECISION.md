# 裁决

## 定案

采用[候选一](PLAN-1/README.md)，由断言接收者注入 ctx，集合与单个业务事实分别保留类型和消费语义。

## 依据

推荐候选一：材料 Match 自行取数，Framework 在调用处注入当前接收者的 ctx。

## 否决项

候选二需要两处接线，且公开用量入口不统一，不满足作者要求。

## 独立 Astra 审查

首轮审查提出三项 P1：只读材料类型不一致、receiver/scope 契约不足、Agent 汇总丢失逐次缺项。
类型声明统一为 ReadonlyMaterial；架构明确 receiver 的 scope/cut 和提取方法闭包；SessionManager 保存逐次 send 贡献。

三项 P2 也纳入正文：独立输入总量优先、预算签名与定点边界、完整 payload 的 Assertions Attachment owner。
第二轮复核闭合其中五项，只读映射仍破坏受管数组的方法重载。
Library 在递归映射前保留既有 ManagedToolCalls 与 ManagedEventOccurrences；Astra 的真实类型实验验证这一局部修正。

真实 180 秒消费者进一步证明固定 256 项和 48 KiB 会在 predicate 前拒绝集合。
读取集合 capture、全部命中 Judge 材料与审计预算分开配置，所有后续持久化和引用上限同步收敛。
新增 1000 操作、完整双方对话、已知见证与各层容量耗尽的消费场景。

单个聚合业务事实也由同一 receiver 注入 ctx，defineContextMatch 接已有 BooleanMatch 或 ScoreMatch。
它区别于整组材料 selector，一次只评分一个事实，不能隐式逐项平均。

第三轮复核确认单事实 API 和 20 个类型负例，容量链补齐了公共读取、预留结算与完整度投影。
剩余 P1/P2 均闭合，采用候选一。32 MiB detail 边界有明确最坏字节核算，不增加另一份材料读取协议。
设计审查不替代安装候选验收；阶段候选仅证明各自接线切片，最终验收必须兑现全部容量与完整读回场景。

## 遗留风险

Reader 是可信业务代码，只读类型不构成 JavaScript 沙箱；应用对事实完整性声明负责。
合法框架预算不保证外部模型接受同等大小的请求，模型拒绝仍为不可判定并保留审计。

## Agent 默认材料与统一包装

应用层的 Agent usedNoTools、calledTool 与游戏业务断言封装各自事实和判据。
通用 closeQA 组合材料选择与受管验收评分，再通过同一 check 登记；Agent 应用提供当前 scope 的 question-only 默认写法。
显式领域 Match 只负责选择全部命中材料，不由作者预执行 predicate 或自行调用模型。

独立 Astra 审查确认统一入口和三类重载，并提出三项 P1：messages 完整性、失败 send 漏录、跨 Turn 关联越 cut。
完整性依赖表、全部 sealed observed 账本、逐次 outcome/coverage 和私有 cut frame 闭合这些问题。
P2 的未知关系零调用、薄 EventMatch、Session 分组顺序与领域捕获上限也已明确。
第二轮只读复核认可定案，没有剩余设计阻塞；实现验收仍需证明失败行保留、前缀内关联和关闭后的零读取。
