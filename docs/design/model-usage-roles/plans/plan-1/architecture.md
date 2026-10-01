# 阶段一数据与生命周期

## 配置与执行身份

普通 Adapter 的 Experiment 在 define/Host 归一为一个 canonical models 映射；键排序、值显式 model/effort null。
单模型简写与具名 default 的相同选择归一为相同值，ctx.model/effort 只由此值派生。
新字段穿过 Host plan/run、adoption、expected target、Attempt create、Run writer，不依赖只在 defineExperiment spread 一次。

普通 Adapter 的 ConfigIdentity 新增 models: `{ version: 1, slots: canonicalModels }`。
原 model/effort 字段仅保留同一 default 的派生值，不能从原作者语法重新读取。flatten selector 使用 models.<slot>.model 或 reasoningEffort。
该 version 进入 config hash 与逐 Eval fingerprint。历史没有 models 的配置身份保持旧域，不伪装成新 identity，也不自动复用。
Agent 的现有单模型 identity 不在本切片改变；它拒绝 models，避免提前承诺多模型执行。

RunExecutionContext 增加可选 models，值为 canonicalModels。新普通 Adapter Run 必写，即使为空；旧 Run 与 Agent 可缺席。
Core 严格 Schema 显式声明该可选字段，不靠允许任意额外键。字段在既有 context JSON 内保存，不新增 SQL 表或回填历史。
writer、adoption writer、reader、config identity 的投影共用同一归一 owner。

## 调用事实

Adapter usage family 发布 revision 3。每个 call 新增必有的 modelSlot:string|null，其余 call、route、cost、priceReceipts 语义不变。
公开输入省略 modelSlot 时规范化为 null。collector 在建立快照时验证非空用途键属于 frozen models，之后参与幂等比较。
callId 仍标识物理调用，retryOf 仍指此前物理请求。modelSlot、provider、model 都不是去重键。

Reader 分别用 v1、v2、v3 严格 Schema 验证。v1 仍投影缺失 route/cost/proof；v1/v2 的 modelSlot 只读投影 null。
不重写旧字节、不按新配置补用途、不按新价格重算。Inspection 的 family revision 分支必须显式接受三种格式。
读取 v3 的非空用途引用时，以 origin Run 的已封存 models 验证，不用当前项目或引用 Run 的配置。
引用无效返回正式 invalid source，不能把它当未归属调用吞掉。

应用物理贡献身份为 originRunId + originAttemptId + application + callId。
同一 origin Attempt 被多个 Run 携带或引用时只计一次。配置用途、实际 provider/model 与引用 Run 不改变物理贡献身份。
单次 attempt.usage 先按 locator 查找 origin 并固定 PublicationCutoff，再读取该 cut 的配置与附件。

## 投影与费用

group owner 从全部已封存 calls 和 priceReceipts 计算，不能消费被截断的 preview calls。
每个配置用途的 recordedCalls 同样从全账本计数；合法账本可得 0，缺源或 invalid 为 null，不受组预览截断影响。
每组 tokens 和 costs 分别计算完整性；source collection partial 传播到组指标，模型或用途身份未知不自动使已知金额变成未知。
相同 provider/model 的不同用途保持两组，同一用途发生回退也保持不同实际模型组。

应用 totals.costs 与现有 costUSD 保持应用口径。新增 judgeUsage unavailable 与 totalCosts 缺口，不伪造完整总成本。
阶段一 totalCosts 只投影应用已知金额；missingSources 必含 judge，应用自身不完整时也含 application。
Show 与 View 消费相同 closed result，模型配置、实际模型组、应用费用、裁判缺口、总费用小计分开显示。

reported 包括零始终优先。估价仍只按 call.model exact/prefix wildcard 与显式 fixed profile，不声称按独立 serving provider 定价。
price proof 的 rates、selector、digest、缺项与历史读取保持。不同货币不合并，未知不补零。

分组上限 64 只限制返回行数，不改变全部调用的分母或已知金额。totalGroupCount/omittedGroupCount 说明预览范围。
单 Attempt 用量的 512 KiB 与完整实验结果的 4 MiB 预算分别生效，拒绝时保留预算原因，不删部分费用来伪装完整响应。

## 后置范围

Agent reported-sends 是独立粒度；其中配置 model 和历史 adapter.name 不能充当实际 provider/model。
不迁移 Agent 历史为物理调用，也不在这一阶段重构 Agent 多模型执行。

Judge 后续账本的物理键必须含 origin Attempt + Assertion entry + logical ordinal + transmission ordinal。
not-sent 不计物理请求；pending 只在内部，终态统一封存。不能向 snapshot-only recordUsage 塞两阶段 patch。
当前失败 HTTP body 缺失，成功 audit 解码不能证明完整费用；阶段一明确显示 unavailable，不等待这项重构。

## 验收

公开安装候选验证三用途配置、单模型简写等价、未调用用途、同模型多用途、回退模型、用途未知与错误引用。
验证重试物理 call、reported zero、费用未知、超过 128 calls 和超过 64 groups；UI 不按 preview 重算。
专门验证 a 有 129 个实际模型组、z 有 1 调用、unused 无调用：即使两个预览都只含 a，配置计数仍为 129/1/0。
验证新 v3 与历史 v1/v2、引用 origin、不同配置的 reuse 失效，且旧应用 costUSD 不改变口径。
RPG 使用已保存的真实回执离线归档，不运行付费模型；单槽 unsupported reasoningEffort 在开局前拒绝。
