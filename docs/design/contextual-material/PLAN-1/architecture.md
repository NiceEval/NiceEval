# 上下文材料 Match —— Architecture

## 所有权

`Attempt` 拥有 Assertion runtime、应用 ctx、使用账本和运行时钟。
每个断言接收者拥有只读 ctx facade。Adapter 是 create 返回的应用上下文；Agent 是当前 turn、session 或 attempt 的正式事实 facade。
材料声明只持有 reader 和 predicate，不持有具体 ctx、Attempt 或世界对象。

接收者 check 与 closeQA 通过同一个内部求值入口传递 ctx。
绑定发生在 framework 的 facade 创建处。业务没有材料 reader 注册表，也不需要再次绑定。
框架使用私有 receiver 到 runtime 映射，不能全局查找或按 ctx 名称探测。
Agent 的受管集合继续校验 Attempt owner 和事件关系，不转换成失去私有关联的普通 JSON 后再匹配。

## 求值与证据

断言调用时检查生命周期、材料声明品牌、参数和预算，然后调用 reader。
读取完整性在 predicate 前捕获。框架复制每项身份和原文，保留源顺序并建立本断言的不可变事实切面。
普通 domain predicate 在这份切面逐项求值；托管工具和事件 predicate 使用原有受管关系求值器。
保存 examine、matched、mismatched、unavailable、complete、exhaustive 收据。

存在性匹配默认至少一条。已知命中可证明存在，即使集合 partial；不存在仅由完整且可判定的全部材料证明。
QA 需要完整集合和全部可判定 predicate。任何缺失、超限、未知关系或未知 predicate 都不可判定。
完整空集为零分并且零调用。非空全组保序交给同一个受管 ScoreMatch gateway。

材料容量上限是接纳边界。超限保留原因和有界审计，不抽样、不截断并声称完整。
每项 ID 唯一且稳定，框架不根据业务字段合成身份。
`closeQA` 的 question 是验收问题。Rubric 要求只根据材料回答，原文仅当数据。
分类 satisfied、not-satisfied、insufficient-evidence 分别返回 1、0、unavailable；模型引用仅允许匹配项的 ID。

## 类型与可信代码边界

Ctx 参数逆变，只能消费满足 reader 所需结构的接收者。
私有品牌阻止 Boolean true、普通对象和未登记 evaluator 被当成材料。
结构类型相同的应用共享同一契约是合法复用；不要求用名称人为区分。
Reader 是可信作者代码，纯函数约束不构成 JavaScript 沙箱。只读类型约束 DTO 字段、数组和读取方法返回的数据；函数副作用仍由作者契约约束。

Getter 每次从正式 owner 取得新不可变快照，facade 转发属性描述符而非在 spread 时求值。
统计投影由中立统计模块拥有，公共作者入口与 Inspection 使用同一投影。
Agent 与 Adapter 的原始证据模型保留区别；统一字段不伪造相同精度或物理请求证据范围。

## 验收

通过安装候选的公开 Eval 验证同项组合、跨人物/Attempt、材料突变、Agent scoped owner、未知完整性与预算。
假模型只模拟 HTTP 边界，验证一次 Judge 收到全部原文、顺序、引用和实际调用次数。
用量验证未知桶、失败、重试、实扣零、十进制边界、混币种和 getter 冻结。
完成定向 E2E、必需可靠性矩阵、typecheck、Unit 和文档 lint 后 pack；跨设备消费者自行拉取候选。

## 接收者与 scope 绑定

内部每个 receiver 保存 runtime、assertOpen、readContext、scopeIdentity、readCut 和 closed。
Check 是独立闭包，保存其 receiver；closeQA 同样保存它。提取方法后仍使用原 receiver，不读 this 或全局上下文。
非材料 check 继续登记到共享 runtime；材料 check 和 closeQA 都先通过该 receiver 捕获。

Adapter ctx 来自 create 的返回值，没有 Agent scope 字段。
Agent scopeIdentity 按 turn 的 sessionId/turnId/scopeId、session 的 sessionId/scopeId、attempt 的 scopeId 校验。
`readCut` 在 reader 前捕获正式 producer 的 sequence；工具和事件保留各自完整性，不从另一个通道补 complete。

受管集合必须具有同一 runtime owner、相同 scope 身份和相同 sequence 切面。
Attempt owner 或 scope 错误是作者错误；旧 cut 为 unavailable，不以少了后续项的材料证明整组问答。

ctx 的 getter 在 reader 调用期间从当前 owner 读取。Session/turn/attempt 分别构建自己的 AgentMatchContext。
关闭所有 receiver 时置 closed，并释放 readContext/readCut 引用；迟到 create 不能重新安装或开放它。

## Agent 官方用量贡献

SessionManager 在每次实际 Agent send 开始时创建一项 pending 贡献，在该次 send 终结时冻结其用量、coverage 与 outcome。
Ledger hook 尚未调用 Agent 就失败时没有贡献。自动重试的每次调用单独贡献，不按逻辑 turn 去重。

```ts
interface AgentUsageContribution {
  readonly sessionScopeId: string;
  readonly turnId: string; // 所属公开 send 的逻辑范围
  readonly sendAttempt: number; // 0 起始的实际调用次序
  readonly state: "pending" | "terminal";
  readonly outcome: "completed" | "failed" | "interrupted" | null;
  readonly model: string | null;
  readonly usage: Readonly<Usage> | null;
  readonly coverage: ResolvedEvidenceCoverage["usage"];
}
```

Pending 的 usage 为 null；未知字段保留缺项。终局失败、已吸收重试、成功返回均有一项终态贡献。
一项 Agent send 的上报可包含内部多个模型请求，因此它不是模型请求计数。
Turn 统计包含该逻辑 send 的全部重试及最终调用；session 按 sessionScopeId 选择；attempt 包含全部贡献。
贡献和当前读切面由 SessionManager 拥有，不由 Eval 再聚合日志。

每个 token 指标逐贡献核对字段与 usage coverage。
有独立输入总量时使用它；否则输入总量按三个互斥桶计算，缺项为下限。
范围内任何 pending、缺桶或 partial coverage 都阻止 exact；已知非负值仍保留为 lower-bound。
无任何已知观测时 unavailable，不补零。非法数值使对应指标 unavailable 并保留失败原因。

费用逐贡献优先真实 costUSD；没有报告时只使用显式 pricing 的当前模型配置。
number 在单项进入投影时转换为 canonical decimal，不先累加浮点。
缺少计价桶或对应单价为部分估算；已知零桶无需单价即可贡献零。
缺少模型、全部 token、所有费用或价目表时贡献费用未知。
范围金额使用定点累加；unknown、pending、部分费用和其它币种禁止用已知美元小计通过上限。
Token getter、maxTokens、费用 getter、maxCost 读取同一官方投影，不另建糖的统计算法。

## 完整材料的持久 owner

普通材料允许有限 number、string、boolean、null、undefined、稠密数组和普通数据对象。
对象仅使用自己的字符串数据属性；Date、Map、Set、访问器、Symbol、函数、非有限数、循环和类实例不可捕获，产生 unavailable。
对象按值求证，稳定 ID 表达事件引用；JavaScript 对象身份不作为可持久业务证据。

每个 ID 非空、最多 128 UTF-8 字节、无控制字符、同集合唯一。
完整捕获使用材料声明的 capture 预算，默认与可配置上限见 Library。
计量包含集合状态、每项 ID、原文、元数据和 undefined 的正式快照标记，不只量 JSON.stringify 丢失字段后的结果。
Question 最多 8 KiB；Judge 配置的调用、材料、审计预算在 read 前校验。

已接纳完整 payload 由 Assertions Attachment 的现有 bytes content 保存。
Runtime preview 仍可有界展示，但私有 sidecar 携带完整不可变编码，并在 freeze/producer 转换时保留。
完整 payload 不经过普通 boundedSnapshotValue 的 8 KiB 字符串和深度 8 截断。
Boolean 与 QA 都持久化同一完整事实；QA 审计额外保存命中项和裁判引用。

源集合 partial/unavailable 的语义由 coverage 与选择收据保留，不能因为展示摘要可读就升格 complete。

## 不可判定的精确诊断

材料拒绝保存机器可读 diagnostic code、说明和有界观测值。
容量拒绝区分 item-limit、byte-limit、depth-limit、node-limit 与 Judge 预算拒绝。
源集合缺失/partial、单项 predicate 未知、cut 不一致、不可捕获值各自保留具体 reason。
Boolean 与 QA 的终态均携带选择收据；无模型调用的路径也保存完整原因。

公共 evaluation 可以使用 source-unavailable 总类，但 detailed diagnostic 不只重复这个总类。
Reader 的 producer 失败和作者契约错误保留错误因果；未知状态不能被解释成条件不成立。

框架只捕获 reader 返回的材料，不遍历、复制或审计整个 app ctx。
Reader 的 domain DTO 应包含业务谓词和裁判实际需要的原文与回执，不带无关整局 trace。

## 读取集合与裁判容量边界

捕获先保留读取集合的完整性声明和已知总项数，再按集合顺序逐项接纳。
接纳一项必须完整捕获该项；节点、深度或字节预算不足时不保存半个事实。
扫描和复制过程增量计量，不能先无界序列化整份集合才检查字节预算。
超过 maxItems 的集合仍可捕获预算内的前序项，随后停止，不挑选或越过不利事实。

预算停止保留具体 limit、configured、observed 与 stoppingIndex，并使 exhaustive 为 false。
complete 保留原集合声明，不能把已捕获前序项包装成完整集合。
持久事实明确分开 declaredState、knownTotal、已捕获 items 与 exhaustive，不输出 state:complete 的前序子集合。
存在性对已接纳项使用正式 predicate；已知命中可通过，并保存未穷尽的收据与容量诊断。

没有见证时，只有读取集合 complete、扫描 exhaustive、全部 predicate 可判定才失败；否则不可判定。
不存在的证明不能把预算剩余项当作不匹配。

QA 要求读取集合完整、捕获穷尽、全部 predicate 可判定；预算停止时零模型调用。
同一选择收据的 decisive 按所消费的命题计算；存在性的已知见证不能把 QA 的整组材料标成可判定。
框架将全部命中项保序组装为一次请求，在调用模型前核对选中材料预算。
捕获容量允许较大集合，而命中项较小，可以使用较小 Judge 材料预算。
反过来，命中项超过 Judge 预算即不可判定，不能通过缩小捕获预算得到成功问答。

完整读取事实由断言 subject 的 bytes content 保存；ScoreMatch 初始输入只保存问题、集合身份和选择声明。
完整未命中事实不作为 ScoreMatch 的初始材料重复计费，命中组仅在受管 llm 调用处计量。
Judge 审计保存完整实际请求、响应、引用和选择收据，不依靠 preview 恢复正文。
受管引用校验最多允许 16384 个唯一材料 ID，和合法集合项数上限一致。

ScoreMatch 与现成 Judge 共享新的材料、审计可配置上限，不保留一个只适用小样本的隐藏分支。
其捕获器最多深度 72、2097152 节点，给合法事实材料外的请求封装保留空间。
审计 decoder 支持最多 8 MiB；持久化 envelope 使用同一完整 bytes sidecar，不能被 256 项的 preview 数组限制截断。
审计预算包含引用 schema、JSON 转义、协议字段和有界响应的保留空间；不足时返回具体不可判定原因。

预算同时核对完整持久 envelope 的编码字节，不能只量内部 canonical audit 而漏掉再编码的膨胀。
模型调用前按响应字节上限预留 envelope 的最坏编码空间；封存后的完整 content 不得超过同一审计预算。

Attempt 的文字材料与托管审计保留容量上限为 64 MiB，与图片保留容量分开。
调用 reader 前按配置的捕获字节上限与裁判审计预算预留，并留出 64 KiB 的有界诊断空间。
捕获后按实际事实编码降低捕获预留，审计预留持续计入运行中的模型调用占用。
终态后释放临时源对象和模型资源，保留已封存证据。
无法预留时产生 assertion-retention-budget，不执行 reader 或模型，也不把合法配置错误归责作者。
选择声明的预算可配置，但 Attempt 总量是运行时的有限接纳边界；不设置无穷预算。

公开 show 直接展示具体容量诊断。
捕获拒绝区分 source-item-limit、source-byte-limit、source-node-limit 与 source-depth-limit。
裁判或保留拒绝区分 judge-material-budget、judge-audit-budget 与 assertion-retention-budget。
这些是材料不可判定的具体诊断；source-unavailable 仅保留为断言结果的总类。

单项 attempt.assertion.detail 的完整机器读取上限为 32 MiB。
读取沿现有严格 result schema 返回完整内容和裁判审计，不增加第二套材料读取协议。
该上限容纳 4 MiB 事实内容、8 MiB 裁判 envelope 的 base64，以及解码审计与字段开销。
detail projector 与最后交付处使用同一个断言专用上限，不能再经过默认 512 KiB 的 boundedJson。

其它查询结果继续使用各自原有边界；show 的人读正文仍使用有界 preview，具体诊断不因正文较大被省略。

## 单个事实的上下文 Match

ContextBooleanMatch 与 ContextScoreMatch 共享 receiver、assertOpen、只读 ctx、readCut 和捕获预算。
Reader 同步调用一次，MatchFact.available 的 value 按正式捕获规则复制一次，之后只把这个副本交给已有 Match。
不会扫描 value 内的数组并重复调用 scorer；一个聚合事实只登记一个断言，ScoreMatch 最多求值一次。

事实内容与精确拒绝原因由完整 bytes content 保存，普通 preview 保持有界。

Reader 返回 unavailable 或事实捕获失败时，不运行 BooleanMatch、ScoreMatch 或模型。
纯本地 ScoreMatch 使用现有 number 测量路径；托管 ScoreMatch 使用现有 gateway，保留模型取消、审计和使用量。
整体评分事实的 capture 没有 maxItems，字节、节点与深度预算和集合同名字段使用相同规则。
上下文事实不是集合 selector，不参与 closeQA，也不引入另一份注册或绑定表。

## 容量记账与证据完整度

每项断言持有一个私有预留凭证，转换为 registered 后才归属 runtime。
普通 Boolean、存在性和本地 ContextScoreMatch 只预留捕获与诊断容量，不预留裁判审计。
closeQA 使用 JudgePresetOptions 的 maxAuditBytes；托管 ContextScoreMatch 使用其已有 ScoreMatch 定义的 llm.maxAuditBytes。
两者都不从集合项数推导裁判调用次数或审计容量。

Reader 抛错、登记失败或登记前取消，凭证退还全部预留并释放临时捕获。
成功登记后，正常结束、零调用结束或取消均按实际封存 content 与诊断字节结算，退还未用审计与诊断预留。
保留中的完整证据继续计入 Attempt 占用，不能随模型资源释放而退还。
凭证结算以一次性状态转换保护；取消与迟到完成不能两次退还、重新增加内容或触发模型。
封存字节不得超过凭证额度；终态前必须已为拒绝原因保留空间，不靠封存时抛错丢掉原因。

读取集合完整性、捕获穷尽性与持久 coverage 分开表达。
完整捕获且原集合 complete 时 coverage.complete；preview 省略不改变完整 content 的证据完整度。
原集合 partial 时保留 producer 原因，使用 partial/provider-limited 与对应 limitation，不补 complete。
读取集合 unavailable 时使用 unavailable/source-unavailable，并保留原始 reason。

因捕获预算停止时，coverage 使用 partial/capacity-limited。
对应 limitation 为 capacity-limited，保存 capturedItems、knownTotalItems 和 omittedBytes。
knownTotalItems 是读取集合声明的长度；省略字节未观测时 omittedBytes 为 null，不伪造零或任意下限。
新增这个明确的 limitation，而不把容量停止谎称随机 sampled 或实际正文已知字节数的 truncated。

不可判定的单个事实与 reader 前的容量拒绝没有前序事实，使用 unavailable coverage 与具体容量诊断。

Coverage 与 receipt 共存，预算停止的存在性见证允许 matched，但保留 partial/capacity-limited 和 exhaustive:false。
相同事实的 QA 仍为 unavailable；两个消费命题不能共享一个已知见证的成功判定。

## Agent 默认问答的应用边界

Agent facade 持有当前 receiver 的私有默认历史 reader。这个 reader 只拥有从正式账本到只读 DTO 的应用投影。
它没有全局注册表，不进入 Adapter-neutral core，也不增加公开材料绑定。
历史 DTO 包含原 recorded event 和精确关联的逻辑工具事实；非精确关联保留其未知关系并使默认材料 partial。
默认完整性依赖 events、messages、actions 与正式 observed cut；usage/data 不参与。

| 材料选择 | 必需完整性 | 材料语义 |
|---|---|---|
| 默认历史 | events、messages、actions | 完整正式历史及工具关联事实 |
| EventMatch | events | 正式事件流的三类薄投影，不声称拥有完整 provider 对话 |
| ToolMatch | actions 与正式 cut 内的工具关联 | 工具开始、回执与精确关联事实 |

默认历史的额外通道要求不改变既有 EventMatch 断言；actions 不完整不能使完整事件流上的消息不存在判断变成未知。

投影使用全部 sealed observed send，包括没有返回 Turn handle 的失败和中断，并保留每次封存的 outcome 与完整性。
失败没有可信完整 Turn 时保留所有正式事件行并降级；进行中的 send 同样不可证明完整。
若已吸收重试报告了没有封存进正式 observed 段的事件，默认历史声明 partial，不为它补造稳定事件身份。
不以 scope.turns 或成功路径聚合统计代替正式账本，不因过滤或缺失关系变成 complete。

通用 closeQA 先验证参数，将 selector、question、options 编译成私有评分 Match 声明，然后调用同一 receiver 的 check。
check 在同一分派入口识别该声明，完成 ctx/cut 捕获、全量 selection 和受管评分登记。
Compiled Match 不公开新语法，不捕获应用事实，不执行 reader，不获得另一个 runtime owner。
已有 usedNoTools 的零出现判据也继续通过 check 登记；应用包装不直接调用 evaluator。

Agent 提供 question-only 与领域 Match 简写，其完整材料选择仍归一化为现有 MaterialMatch。
提取方法保持原 scope 闭包；关闭后由 check 的生命周期 guard 拒绝读取和模型调用。
默认历史保留 cancelled tool-finish 和所有非工具事件，不能复用会遗漏这些事实的 eventOccurrences 三类投影来声称完整历史。

验收包含 root/session/turn 默认材料、用户及助手完整消息、工具输入和失败回执、取消与未知关系、提取方法、显式 EventMatch/ToolMatch、默认及显式预算。
验证 usedNoTools 不接受 Match，核心 check 与两种包装均只有一个 entry、一次评分和相同终态审计。

### Cut 与历史关联

Receiver 的 readCut 在 ctx reader 前执行一次，并将不可变 cut 写入该 receiver 的私有调用 frame。
默认 selector 不返回给作者，也不允许拿到另一个 receiver；reader 只消费该 frame 中当前调用的 cut。
Turn 按自己封存的 throughSessionSequence 取得同 Session 前缀，先关联全部前缀，再只选择该 Turn 的正式事件。

Session 与 Attempt 按各自 call-time cut 取得全部 sealed observed；引用、enrichment 和完整性均不能越过 cut。
跨 Turn 的工具开始和回执因此能精确关联，旧 Turn 的材料不会被随后回执重写。
缺失前序、orphan、ambiguous 或跨 Session 关系保留原行与具名原因，使默认集合 partial 而不是丢弃整组。
正式事件的 summary 保持字段标签；它不是自动截断，也不能补成 provider 原文。

框架为每个 sealed observed send 保存对应 outcome 与 evidence coverage，成功、失败和中断终结都写入。
默认 history 投影从这个官方账本取数，既有 Agent 集合也不能漏掉已封存的失败 send。
关闭 authoring 时清除所有 receiver 的 read/cut 回调，并清除私有默认历史 frame；已有断言仅持有捕获事实。
任何提取的方法在关闭后先被 check guard 拒绝，不执行 reader。

排序沿正式事件账本的 Session 分组和 sessionSequence；材料说明与 rubric 都禁止将跨 Session 的数组位置当成墙钟总序。
