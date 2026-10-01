# 执行轨迹应用展示：独立设计审查

审查角色：Review。任务：`display-review`。模型：用户指定的 Codex `gpt-6-astra`。日期：2026-10-01。

审查对象：[共同目标](GOALS.md)、[限制](LIMITS.md)、[场景](CASES.md)、[待定裁决](DECISION.md)，以及两个候选的全部正文。
本意见不采用方案，也不修改产品契约。

## 审查判断

有条件推荐 PLAN-1，但不建议按当前正文定案。未发现 P0；下列 P1 应在采用前收敛。
写入时封存展示数据符合历史独立读取与固定 Inspection 呈现边界；问题主要在读取契约、状态、预算和持久格式尚不完整。
PLAN-2 确实不能满足 G3、G5，但有些负面评分理由不成立，不能用它们放大 PLAN-1 的优势。

`satisfied` 在此只能表示设计契约足够明确，不能表示实现或测试已通过。
本次没有运行 E2E，也没有安装依赖；所有运行效果均待验证。

## R1 · P1：Stable identities 示例直接违反 C8 的验收方式

**判断与位置：** `plans/plan-1/cli.md:31` 将 item、tool occurrence、command 与 event 写在一行。
这与 `CASES.md:14` 的“现有断言无需修改”冲突。`plans/plan-1/README.md:82` 和 `DECISION.md:13` 因此不能宣称 G2 已满足。

**证据：** `e2e/inspection/test/show-cli.test.ts:45` 的提取函数要求整行符合 `标签 + 单个非空白 ID`。
同文件第 321–326 行分别提取三个 ID，并要求它们在输出中出现不止一次。
`packages/niceeval/src/show/render.ts:968` 逐行输出稳定身份。
按方案示例实现时，三次正则提取都不能命中该合并行；这不是仅凭测试涉及范围不足推测的风险。

**建议：** 每个稳定 ID 保留独立一行和原有标签，新增 event/evidence 行。
将类型、身份原值、去重范围和遗漏计数写入结果契约；不同 selector 类型不能只按字符串合并。
同时明确 `t1.c1`、`cmd1`、导入 key 和原生 source ID 仍不能用于精确展开。

## R2 · P1：三个 section 没有定义完整的分页与状态语义

**判断与位置：** `plans/plan-1/architecture.md:33` 定义顺序，第 41 行定义缺席即省略。
`plans/plan-1/cli.md:6` 暴露 continuation，但正文没有确定它推进哪些 section、筛选作用在哪里，以及各身份索引的预算。
`plans/plan-2/architecture.md:24` 存在相同缺口。三个 section 并列本身不能证明 C8 或 G2。

**证据：** `docs/feature/inspection/cli.md:195` 要求 outline 与 identity index 都有界并报告遗漏。
第 237–239 行规定通用页最多 32 个事件、64 KiB，并绑定筛选、origin、source、cutoff、family revision 与 behavior version。
第 379–380 行区分 capture、producer collection 和当前页状态，要求 partial 空索引显示限制。

`packages/niceeval/src/inspection/trace.ts:215` 在没有通用 collection 时，将 Agent items 投影为通用事件。
该投影在第 276–287、415–418 行保留筛选与 continuation。
同文件第 61–74 行给 Conversation 与 Commands 独立预算，第 601–627 行分别限制稳定身份数量。
这些是实现证据，不代替目标契约，但证明“Events 只属于 execution-traces”不能未经说明就等同于保留全部读取能力。

**具体风险：** 丢掉 Agent 通用投影后，已知 ID 仍可展开，却可能失去分页发现更多 Agent item 的路径。
把新 Events 预算合并进一个全局前缀，也可能挤掉工具结果或 command 身份。
空 Events 页、从未采集、采集失败、invalid source 和分页结束若都按“缺席”省略，会隐藏不同事实。
这些运行退化尚未实测，标为**待验证**。

**建议：** 明确 Agent 通用投影的归属和筛选语义，并给出完整 section 结果形状或对既有结果字段的精确引用。
写清各 section 的条数/字节预算、continuation 推进范围、独立 omitted 计数和空页规则。
固定顺序可以采用，但不能把顺序解释成跨 source 因果；Events 不应消耗原 Agent outline 的保留额度。
仅允许真正未采集且无诊断的 section 按约定省略，partial/invalid 即使零项也应保留原因。

**Agent 验收边界：** C8 断言检查标题、工具内容、三种 detail 和非法 handle，未证明大 outline、分页、混合 source 或完整度合并。
采用后的最小验证需检查 Agent-only、Agent 加分页 Events、partial 空页，以及默认 outline 外已知 ID 的展开。
当前 renderer 还在 `packages/niceeval/src/show/render.ts:919` 输出 Diagnostics；“只有三个 section”是否移除它也需明确，不能无声删除。

## R3 · P1：1 KiB 预览与 fields 的机器形状不一致

**判断与位置：** `plans/plan-1/cli.md:82` 承诺每个文本字段最多预览 1 KiB。
第 118 行却将 `fields.value` 定义为完整标量，没有 string preview 或 `omittedBytes`。
`plans/plan-1/README.md:86` 不能以当前形状证明 G6。

**证据：** Library 允许一份接近 8 KiB 的字符串作为单个 fields value。
它在 outline 中只能完整输出，或被截断但无法通过声明类型报告遗漏。
每事件 4 块、每块文本 1 KiB 也不自动满足每页 64 KiB：32 个事件仅文本就可达到 128 KiB，尚未计入 envelope。

**建议：** 给字符串标量明确预览形状，或明确 fields 整块的有界投影及遗漏信息。
由 Inspection 计算 UTF-8 安全前缀与遗漏字节；计量方式需说明是否包含 JSON 转义、键名和结构开销。
分页预算应计入序列化后的完整事件投影，包括 display，且保证合法单项能够前进。
`8 KiB / 4 块 / 1 KiB` 对 C1–C3、C9 是合理的初始值，但缺少代表性大输入证据，容量适配性为**待验证**。

## R4 · P1：image 闭合失败被错误地表示成不存在

**判断与位置：** `plans/plan-1/architecture.md:63` 将图片 descriptor 校验失败映射为 `artifact.state: not-found`。
`plans/plan-1/cli.md:125` 的结果只允许 available 或 not-found，不能承载已知内容损坏。
这不符合既有附件读取边界，L9 只能评为 partial。

**证据：** `docs/feature/inspection/architecture.md:128` 只在附件 ID 不存在时返回 not-found。
第 130–132 行要求验证 origin、metadata、长度和完整 SHA-256；不一致返回 `inspection-record-integrity-failure`。
`docs/feature/adapters/library.md:273` 也要求接纳、发布与读取时验证同 owner 内容闭合。

**建议：** 明确不存在与完整性错误的不同结果；若希望块级隔离，应先确定能够保留完整性原因的 typed 结果，不能伪装成缺失。
补齐持久引用中固定的 descriptor/digest 形状，以及 carry、Snapshot 导出和读取时对 origin 附件的闭合关系。
明确图片校验是否共享既有附件读取预算、重复引用怎样去重，以及 View 何时拉取 bytes 和释放资源。

`LIMITS.md:51` 已说明 `ctx.attach` 不解码内容，因此媒体类型白名单不能证明 bytes 是可解码图片。
需要规定解码失败的可见结果和浏览器加载上限；是否存在现成可复用限制为**待验证**。
这不要求归档层承担图片解码，也不能直接据此断言存在脚本执行漏洞。

## R5 · P1：持久 revision 与 identity 的表述仍有歧义

**判断与位置：** `plans/plan-1/architecture.md:69` 排除 eval/config/execution identity 是合理方向。
但 `plans/plan-1/README.md:59` 排除“任何 identity”过宽；architecture 第 70 行没有给出新旧 family revision 的具体读写关系。

**证据：** 同 `traceId` 的幂等比较针对规范化快照内容，见 `docs/feature/adapters/library.md:276`。
这与不把观测值用于执行资格比较并不冲突。
但 Snapshot 的 content identity、logical closure identity 与 exact Seal 明确存在，见 `docs/design/cli-insight/DECISION.md:19`。
封存 display 改变内容，不能排除其内容完整性身份。

通用 collection 的既有 revision 为 1，见 `docs/feature/adapters/architecture.md:113` 和第 115–116 行。
“family revision 包含 display”没有说明继续使用 1 还是增加 revision，也没有给出新 reader 怎样处理两种持久形状。
`display: absent` 只是读取投影，不能独自证明历史字节可被对应 decoder 接受。

**建议：** 区分执行资格身份、持久实体身份和内容完整性身份。
展示数据不直接参与前者，内容摘要和幂等比较必须包含展示及其附件引用。
确定 writer revision、支持的 reader revision、缺字段投影、未知 revision/未知 kind 的错误，以及历史 Snapshot 的只读处理。
这属于采用前需要收敛的持久契约，不宜让实现者自行选择。

此外，“不触发重跑”应仅指运行后展示数据不新增资格依赖。
`docs/feature/experiments/cache.md:215` 明确 Eval sourceClosure 改变会改变 execution identity。
Adapter 转换代码位于受追踪源码中时，修改它是否改变 sourceClosure 为**待验证**；不能承诺所有展示代码修改都免于重跑。

## R6 · P2：C9 建模合理，但可复制命令与宽度截断冲突

**判断与位置：** `plans/plan-1/library.md:84` 和第 111–114 行正确描述外部轨迹的有限证据。
对于 C9 所要求的完整轨迹，`partial + external-trace + text/code` 已足够，不需要专门 kind。
collection 状态应相对于明确的采集范围判定；一个完整的外部引用清单，并不等于完整收集了对局事件。

**证据：** `CASES.md:15` 要求可复制查询命令，但 `plans/plan-1/cli.md:79` 规定 code 超宽直接截断。
第 83 行又承诺展开完整展示，没有解释 detail 是否仍受同一宽度截断。
即使少于 1 KiB 的长命令也可能只显示带省略号的不可执行前缀。
图片块第 80 行只列 artifactId，也未兑现 C3 在 `CASES.md:9` 要求的可复制读取命令。

**建议：** 为展开后的 code 提供完整、可复制且不改变 bytes 的呈现路径；显示宽度省略与源文本遗漏需区分。
图片应提供正式 `attempt.artifact` 请求或等价公开读取指引。
只有出现机器可发现的外部目标、统一打开动作等独立需求时，才考虑 external-reference kind。

命令是不可信应用文本，NiceEval 不自动运行、不自动打开、不进行 shell 求值。
PLAN-2 的 `library.md:79` 直接拼接 runId，若含 shell 元字符，用户复制后可能执行额外命令。
应由 Adapter 对外部 ID 采用限定字符集或对应 shell 的正确引用，并让复制动作保留可审阅的完整文本。
禁止 secret 的规则必要，但它不能代替命令参数处理；框架也不应把“可复制”宣称成“已验证安全”。

## R7 · P2：封闭词汇可用，安全规则需要适用于所有读取表面

**判断与位置：** `plans/plan-1/library.md:45` 的五种 kind 足以支持已列场景，且不提供布局或执行接口。
四块上限可以容纳当前场景组合；表格、音频和任意交互不应以开放 kind 偷渡。
`other` 与 speaker 允许 NPC 表达，不必把所有应用事件解释成 Agent 对话。

**证据与边界：** 第 126–127 行拒绝 ESC、CR 等控制字符；`architecture.md:54` 使用 View 文本节点。
这些措施对文本的 ANSI/HTML 注入方向正确。`<script>` 作为文本可被接纳并原样展示，无需仅因标签字符拒绝。
但持久输入、旧 Record、label、speaker、alt、summary 和 limitation 等全部人读路径是否执行同一安全处理，正文没有完整说明。
具体实现安全性为**待验证**。

**建议：** 明确严格 decoder、未知字段、合法字符串及控制字符检查的作用范围；终端防御应按字符处理，不能误删合法 UTF-8 字节。
View 文本不进入 HTML、属性拼接或 URL 执行位置，image 仅从已验证附件 bytes 创建图片资源。
可允许换行和制表符，但它们及 Unicode 双向控制仍可能伪装布局；这与执行注入不同，命令复制场景需保留可辨识边界。

`architecture.md:65` 的“非法展示不影响 Verdict”也过于绝对。
Library 第 129 行返回 rejected Promise；作者若直接 await 且不处理，错误可能进入执行失败路径。
建议只承诺框架不根据展示内容评分；拒绝怎样被 Adapter 处理及怎样登记采集失败，应服从既有调用错误语义。

## R8 · P2：PLAN-2 评分需要纠正，执行时限仍待定义

**判断与位置：** `plans/plan-2/README.md:67` 仅因 View Host 执行项目代码，就将 L6 评为 not-satisfied，理由不足。
L6 的组件、主题与路由边界并不会由封闭数据 formatter 自动突破；renderer 作者接口的冲突应准确放在 L1。
若将 formatter 本身认定为 renderer ABI，需要明确该定义，不能把“加载代码”等同于“作者组件”。

第 79 行以依赖项目为由把 G4 评为 partial，也混淆了同源与历史确定性。
`plans/plan-2/architecture.md:21` 至第 22 行明确由 Inspection 生成同一 result，足以在设计上满足 G4。
源码变化和项目缺失属于 G3、L2，而不是另一个 consumer 私自重算。

反过来，第 69、82 行对 L8、G7 的 satisfied 过于乐观。
第 55 行明确所有历史 payload 可被当前 formatter 重新展示；G7 与 C6 要求旧 Record 不生成展示。
需将“仍可读”和“不补造展示”分别评分，或显式说明采用 PLAN-2 需要放弃哪条目标。

L2 的严格无项目依赖仍不满足，但其降级读取能力应得到承认。
`plans/plan-2/architecture.md:45` 至第 50 行保证缺项目时返回 envelope/summary/JSON；不能概括成整个 query 无法读取。
G3、G5 的否定判断成立，不需要借上述过度评分才能否决。

**执行缺口：** `plans/plan-2/library.md:64` 声明纯同步函数，第 91 行承诺 50 ms。
不传 ctx 不能限制函数闭包或项目顶层代码，正文也未定义可中止同步执行的隔离边界。
若顺序处理 32 个事件，单 formatter 时限总和已达 1.6 秒，项目加载和输出校验尚未计入。
这是 G6 的真实缺口，需定义隔离/取消、总请求预算和资源释放责任；不能把普通计时器写成已证明的同步中断能力。
采用此候选前该缺口应按 P1 收敛；本次没有验证其运行机制。

**公允判断：** PLAN-2 能修正历史展示、避免把展示 bytes 写入 Record，并保留项目缺失时的事实读取。
这些优势在当前目标中权重不足，因为 G3、G5 明确优先；推荐 PLAN-1 仍有充分依据。

## 中立性与候选独立叙述

**问题 3 判断：** PLAN-1 没有声明 Adapter 名或“是否 Agent”的运行分支，见 `plans/plan-1/architecture.md:47`。
按事实 family 选择固定语义，不构成身份特权；所有生产者须具有相同 source 的准入与呈现能力。
Conversation 承载配对关系、Commands 承载执行证据，与通用 message 样式并不等价，因此无需强制合并。
固定顺序的展示优先级可以接受，但不能导致 R2 所述预算饥饿或状态丢失。

PLAN-2 在 `architecture.md:20` 按 Adapter identity 查找 formatter，是显式的作者代码依赖。
它不等于硬编码某个 Adapter 名的呈现分支，但也不能描述成完全没有 Adapter 依赖。

**问题 7 判断：** 两个 plan 均有自己的 Library、CLI、Architecture，未发现把必需契约写成“与 PLAN-X 相同”或“换成”的正文。
仍有一处 P2 局部残留：`plans/plan-1/library.md:129` 的“沿用……现有……”。
应直接写出完整拒绝与采集失败语义。
引用既有 recordTrace 的唯一 owner 本身合理，不应为自包含要求复制整个 envelope 契约。

`README.md:21` 和 `DECISION.md:7`、第 13 行的“不变/不动”属于比较层，不违反 plan 独立叙述规则。
但它们仍缺乏足够证据，应改成待 R1、R2 收敛的条件判断。

## PLAN-1 状态表建议

以下评价针对设计正文的充分性；实现验收均待验证。

| 条目 | 建议状态 | 依据 |
|---|---|---|
| G1 | partial | 五种 kind 支持场景，但 C3 读取命令与 C9 完整复制路径缺失，见 R4、R6 |
| G2 | partial | 存在确定的 C8 示例冲突，分页、完整度和身份预算待定，见 R1、R2 |
| G3 | satisfied | 写入封存、同版本只读且不加载项目；新旧格式细节由 L8 单列 |
| G4 | satisfied | Inspection 拥有展示投影，CLI/View 只呈现 |
| G5 | partial | 文本策略成立，读取时全部字段的检查及图片路径仍需明确，见 R4、R7 |
| G6 | partial | fields 预览类型与总页预算尚未闭合，见 R3 |
| G7 | satisfied | 无 display 时回退 summary/JSON，不生成展示；仍需 L8 的格式规则支撑 |
| L1、L2 | satisfied | 作者只写数据，读取不执行项目或 formatter |
| L3 | partial | 输入拒绝、幂等和 Attempt 总量明确；display 规范化计量及附件预算仍待明确 |
| L4 | satisfied | 已声明与 payload 相同的脱敏责任，不声称自动业务脱敏 |
| L5 | satisfied | 应用文本原文保留；NiceEval 自有标签继续由各 consumer 的文案 owner 提供 |
| L6 | satisfied | 无作者组件或布局接口，仅有穷尽数据 union |
| L7 | partial | selector 名保留，但不足以证明所有 Agent 读取行为保留，见 R1、R2 |
| L8 | partial | absent 投影合理，持久 revision 与历史 decoder 接受规则未定，见 R5 |
| L9 | partial | 同 Attempt 引用原则成立，损坏状态与 bytes 闭合契约需修正，见 R4 |

这些判断对应 `plans/plan-1/README.md:65` 和第 79 行起的表，而非外层 README。
不建议用全部 satisfied 掩盖已经明确的缺口，也不应仅因缺少运行证据就把设计状态一律降为 partial。

## 验证与交接

- 只新建本文件，没有改写方案、Feature、测试或源码，没有暂存、提交或 push。
- 静态核对包括用户指定原文、两个候选全部正文和 Agent 断言；未运行 E2E。
- Feature/Test 受管帮助命令均在 tsx 创建 IPC socket 时因 `EPERM` 退出，未执行相关查询流程。
- `pnpm --silent lint` 在站点准备阶段因 tsx IPC `EPERM` 退出，统一 lint 未完成。
- 补充运行 `pnpm exec vitest run --project lint-docs`。首次运行中，4 个文件通过；受管命令的两项检查因同一权限错误失败。
- 写作命中修正后，`pnpm exec vitest run --project lint-docs lint/docs/docs-writing.lint.ts lint/docs/docs-consistency.lint.ts` 的 22 项检查全部通过。
- REVIEW.md 没有新的写作或链接 lint 命中；其余统一检查仍受上述权限错误阻塞，不能宣称全量 lint 通过。
- 本轮创建的 pane、tab、worktree：无。
