# 材料验收问答 —— Architecture

应用拥有事实、完整性、原始 ID 和顺序。

Adapter 只登记 source token 到 read callback 的 Attempt-local 映射。

closeQA 新入口 在触碰材料前确认 source/selector 品牌、question 与 options，并核对 source 已绑定。

不接受未绑定 source 的 BooleanMatch 推断应用数据输入；不在 Match 中注入 app，不建立全局 callback registry。

一个 source selector 声明登记一个 measurement entry。

调用时捕获 read 结果，排除 accessor、循环、非法 ID 和 thenable。

结构非法为作者错误；合法材料无法安全捕获或超限形成 unavailable entry，零模型调用。

collection 超过材料容量不可裁剪成前缀继续判断；只保留有界限制收据，不保存未捕获材料为完整证据。

ScoreMatch 定义包含 source name、predicate 声明、question、算法 version 与限制；不可序列化函数只诚实持久化声明，不宣称离线重跑能力。

框架在受管 callback 内通过独立 MatcherSnapshot 遍历事实，用既有 evaluateBooleanMatch 求值；and/or/not 全部复用原三值语义。

普通 custom Match 可报告 unavailable，匹配器不得执行 I/O 或读 app。

一次候选只求值一次，不在消费者 filter。

完整非空命中集合交给 ctx.llm.classify，一次调用回答整组材料的验收问题。

输入只包含命中 items、question 和完整 selection receipt。

同一受管 entry 保持失败锁存、模型配置、预算、timeout、signal、usage 和终态审计。

没有第二个 runtime。

unknown 和空分支不调用模型；unknown 不得通过 catch 恢复为零。

未采用/失败项由消费者材料保留，框架不按 outcome 过滤。

Assertion subject 是冻结 source collection 的安全材料；调用 audit 是实际命中材料及分类。

receipt 保留 examined/matched/mismatched/unavailable 和 completeness。

使用现有 managed-score-measurement criterion、definition config 与 Content closure；不增加 durable family 或数据库模型。

模型引用只接受命中 ID，聊天协议验证后保存 citations；TypeSafe 没有引用就明确 not-recorded。

source binder 只在 Adapter factory 装配阶段开放，绑定结束冻结映射。

跨 Attempt、错误 source、晚到 read 和重入均 fail closed。

生命周期守卫归现有 assertions/core，selector 不持有 app 引用或句柄。

验收从安装候选 Adapter/CLI 进入，公开 Inspection 读回；fake 仅是 HTTP Provider 外部边界。

测试涉及同项 and、全部命中保序、两方对话、失败/未采用项、unknown、零调用、超限、引用、取消和closeQA 单一路径和迁移。

核心 closeQA 方法 精确返回 measurement handle，不需要放宽任意 Adapter 用户泛型/overload。

materialMatch 的 Agent overload 从 collection owner 捕获冻结 sidecar 与 rows，不从公开浅投影重建事实。

已有 tool/event query evaluator 供内部选择路径复用，不公开给消费者。

check(selector) 的存在性分支与 closeQA 共用准备和求值函数；它归 Boolean entry 并保留 selection receipt，不运行 Judge。

void handle 不暴露部分材料为完整集合。

## Review 修订：两种快照

MatcherSnapshot 和 JudgeMaterialSnapshot 分开持有。

普通 callback 候选用有界深复制保留原值语义，包括显式 undefined；不调用 accessor/toJSON。

Agent 候选是 scope owner 已冻结的原 row 和关联，保留 WeakMap occurrence、locator 和 lifecycle query evaluator；不能经 JSON 克隆后重新匹配。

JSON 发送快照在登记处准备，与 MatcherSnapshot 同一 cut；无法无损表示的值不发给 Judge。

undefined 不会静默省略成完整输入。

普通存在性可比较保留 undefined 的快照，其安全 evidence 使用既有 tagged snapshot；整组问答对非 JSON 材料 unavailable。

每条已知命中项发送原始完整 value 或 Agent 的完整 correlated occurrence，不从浅投影猜工具输入/输出。

材料关联无法验证保留 unavailable。

## Review 修订：所有权与绑定事务

每个 Assertion runtime 创建一个私有 owner token。

freezeManagedToolCalls/EventOccurrences 的 sidecar 带该 token。

materialMatch 保存已有 managed subject，check/closeQA 登记时校验 token 与接收 runtime 相同；跨 Attempt 拒绝，不重新裁 cut。

静态 source selector 没有 owner，可跨 Attempt 复用定义；每次登记只查找本 Attempt 已提交的 source 映射。

Adapter factory 绑定进入局部事务；组装及返回对象校验都通过后一次提交，失败清空，不留下部分绑定。

绑定阶段关闭后 binder 拒绝调用；作者阶段关闭、seal 或 interruption 清空 read 映射。

已登记 entry 只持有冻结材料和 Match，不再持有 app/read。

read 用 per-registry reading 状态阻止重入，finally 释放标记；read 中重入任意 source 的 check/closeQA 均在下一次读取前拒绝。

## Review 修订：持久化 receipt

所有分支使用现有 AssertionCollectionReceipt 的完整形状：examined、matched、mismatched、unavailable、knownTotal、complete、exhaustive、decisive。

计数仅数实际完成判定的候选；capture 失败 knownTotal 为 null、计数零、complete/exhaustive/decisive 均 false，不假装已检查空集。

只有完整源本身为空时 knownTotal 为零；完整 N 条候选零命中时 knownTotal=examined=mismatched=N。

完整零命中的 complete/exhaustive/decisive 为 true；unknown receipt 仍保留已检查计数。

MeasurementAssertionEvaluation 增加 receipt。

runtime 保留 result.receipt，attachment producer 将其写入既有 evaluation.receipt。

公开 attempt.assertion detail 从 evaluation.receipt 读回，decision.result 仍是结果字符串。

Boolean 与 measurement registration 增加内部 terminalReceipt hook，在中断或未求值时保留进度收据。

收据不放在可裁剪 explanation。

封口调用 terminalReceipt 时关闭进度写入；晚到 callback 不能更新封口计数。

保存实际分类调用的现有 audit，不把零调用伪造为发送。

## Review 修订：引用与严格审计

classify 的 evidenceIds 输入和 citations 输出只在显式请求时存在；ID 最多 256 项，各最多 128 UTF-8 bytes，无重复。

聊天 response 必须返回 citations 数组，成员属于请求 ID 集，无重复；空数组是实际模型返回的空引用。

聊天 audit reader 同时验证新请求、原始 response 和 output 的精确形状及 ID 子集；原 schema 的 optional 分支不需要换 envelope revision。

TypeSafe mapping reader 精确接受可选 evidenceIds 并验证映射；其 wire 不请求不存在的引用能力，output 不带 citations。

ScoreMatchResult measured/unavailable 可携带实际 citations，gateway 和现有 Inspection explanation 保存真实返回值；未请求和 TypeSafe 都标 not-recorded。

insufficient-evidence 的 rationale/citations 保留，latched Provider 失败仍不能由 callback 伪造结果恢复。

更新 Judge authoring revision 及所有公共导出、参考和消费者例子。

## Review 修订：四类容量

候选遍历/快照上限为 16,384 nodes、depth 32、256 items，序列化候选上限 48 KiB；check(selector) 固定采用这些界限。

closeQA 的 maxMaterialBytes 限制初始问题材料和实际命中发送材料，默认 32 KiB、最大 48 KiB；超过任一项形成有界 unavailable 收据，不发模型。

捕获失败材料只保存 source name、predicate name、失败 code 和 bounded counts，不能保存裁剪前缀为完整输入。

maxAuditBytes 仍预留完整审计空间；配置不可能容纳基本定义和终态收据为作者错误。

Attempt 512 KiB retention 总账和 4096 entries 是准入边界；无法准入时无 entry 拒绝，不承诺无限保存失败条目。

## Review 修订：官方统计读取

maxCost 不经 number NumericMaterial 比较金额。

USD 阈值经 canonicalDecimalFromNumber 规范化；金额用十进制字符串的整数/小数位对齐后精确比较（BigInt），可区分 1.0000000000000001 与 1。

已知 USD 超额可以判失败；只有每条 recorded call 都有完整 USD 有效成本且 collection 完整才能判通过。

非 USD 不兑换，混合币种的已知 USD 为下界，仅非 USD 则 unavailable。

费用 snapshot 保留原字符串和receipt。

Collector record 对 decoded call 深度冻结；snapshot 复制并深度冻结全部 calls/collection/priceReceipts，不泄漏账本可变引用。

读取必须先经 runtime.assertAuthoringOpen；closing 禁止读取但 cleanup recordUsage 生命周期不变。

AttemptUsageSnapshot 为 source=adapter 的 recorded-calls 快照或 source=unavailable 且 reason=usage-owner-not-bound 的显式分支。

Agent 新的 usageSnapshot 在未绑定逐物理调用账本时返回后者，已有 Agent usage/maxTokens/maxCost仍由Agent owner提供，不伪装 Adapter调用。

后续统一物理账本属于其 owner 的契约变更，不用 journal拼造。

NumericMaterial 增加可选 provenance={scope,unit,cut,source}，字段提取仍保留并进入Assertion subject。

elapsed scope=attempt/unit=milliseconds/cut=call-time/source=runtime，token metric scope=recorded-calls/unit=tokens/source=adapter。

未上报不代表0。
