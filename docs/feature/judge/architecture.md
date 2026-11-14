# Judge —— 架构

## 一个 Match 执行协议

`defineJudge` 和现成裁判调用公开 `defineScoreMatch`，返回真实 `ScoreMatch`。
`t.check` 统一准备、登记、执行和封口；`t.judge` 校验受管 LLM Match 后转交同一入口。
Context 不按 Judge 名称或预设名称选择另一条登记路径。
普通数值和 Promise callback 在边界适配为 Effect；高级 callback 直接组合 Effect 与受管 LLM 原语。

Match 不拥有 gate、points、stop、源码位置或 Assertion identity。
这些事实仍由同一个 Assertion runtime 保存，每次 `check` 只产生一个 entry。

## 内部模块职责

定义层分别为普通 Judge 和 Agent Judge 创建受管值。两者共用纯参数校验：rubric、anchors 和材料预算的默认值、拒绝条件与原文字节相同；校验不通过构造另一种 Match 完成。
材料捕获独占属性反射、深冻结和图片引用投影；保留拒绝 accessor、proxy 与非 JSON 值的规则。
HTTP transport 独占请求、有限正文读取、取消与释放，不由定义工厂持有资源。

gateway 和审计 reader 共用纯协议 Schema 与概率投影，reader 另外核验关联、摘要和重算结果。共享协议模块可用于浏览器，不导入 gateway 或 Node I/O。
拆分模块保持规范化值、键顺序、Schema JSON、请求字节、身份摘要与资源释放顺序不变，不改变公开导出。

## 授权、身份与输入

入口在材料反射前确认 Match 与调用形状；不存在 Eval 的 Match 允许列表。
高级 Match 接收登记时生成的深冻结材料快照：JSON 保持 canonical 编码，显式图片值按下文的独立 Content 规则捕获，后续调用方修改原对象不会改变输入。
受管 LLM 能力只由框架提供，不是 JavaScript 沙箱。
作者 callback 属于可信项目代码。

高级 Match 显式声明非空 `version` 和 canonical JSON `config`，与名称、预算和协议一起进入定义摘要。
框架同时沿用 Eval 的源码身份；不以 `Function.toString()` 推断隐藏闭包或外部状态。
作者必须把影响评分的参数写入 config，并在算法改变时更新 version。
自定义 criterion 只声明名称和测量尺度，不声称证明 callback 的实际语义。
内置算法的版本、分类映射和配置共同定义它的解释。Judge authoring protocol 的 fingerprint 版本由内置算法
owner 随规则改变维护；它不是历史 durable schema 的迁移信号。

## 预算与生命周期

每个 entry 有独占执行上下文、串行调用序号和失败锁存器。
`maxCalls` 计逻辑原语调用，默认 4，上限 16；每个调用最多 3 次传输尝试。
裁判 Provider 的 timeout 限定该 entry 的整个高级 callback、全部步骤、重试和等待，不能每步重新获得完整期限。

材料按所选模型放得下来约束，而不是固定字节数：

- 上下文上限的取值与 Agent Judge 相同：Provider 显式 `contextWindow` → 按模型名查内置模型目录。发送前估算请求（规则、材料与输出预留 `maxOutputTokens`）是否放得下。
- 放不下时，Turn 与 Session 材料按[既定优先级](library.md#turn-与-session-作为材料)裁剪到放得下；其它材料无法安全裁剪，这一项为 unavailable（`judge-material-exceeds-context`），原因写明估算值与上限。
- 目录里也没有该模型时不做发送前估算；模型报告上下文溢出时，这一项为 unavailable（`judge-context-overflow`）。
- 作者显式写了 `maxMaterialBytes` 时，它是额外的作者上限，超出即 unavailable；未写时没有固定字节上限。

审计不设字节上限，也没有 Attempt 级的材料与审计总账：每次实际请求、响应与终态完整写入受管 Content 分块，读取由 Inspection 分页。不做发送前的字节预留；只有存储写入本身失败才影响结果，归为 errored。图片仍按[图片规则](#图片捕获content-与-v3)单独限制，因为它们约束的是模型输入。

材料放不下、最终传输失败、超时和零陈述锁存 unavailable；非法输出、ID 错误和 callback defect 锁存 errored。
并发重入为 errored，不排队。callback 返回时仍有已准入调用也为 errored；运行时终止并收拢它们后才封口。
callback 捕获失败并返回数值不能清除锁存状态。
取消保持 Effect interruption；callback 结束、失败或 Attempt 取消时关闭执行上下文。
关闭后泄漏的原语句柄不能发送或修改审计；封口从同一关闭状态产生一次不可变快照。
高级 callback 不得派生脱离该作用域的模型工作。

## 完整审计材料

初始输入和动态审计分别进入 Assertion 的受管 Content。
原始 subject 在登记后不回写；封口阶段将关闭后的审计快照作为 evidence 交给现有 content owner。
审计不能依赖可裁剪的 explanation 或 diagnostic。每个 entry 只拥有自己的调用、尝试和最终聚合。

以下为聊天协议 v1 审计的完整逻辑形状。JSON 文本使用 canonical 编码；传输表示按 UTF-8 安全分块并保存摘要和字节数。
请求是实际发送的 JSON body，不包含 Authorization header 或凭据值。

```ts
type AuditFailure = {
  readonly state: "unavailable" | "errored";
  readonly code: string;
  readonly message: string;
};
type AuditAttempt = {
  readonly ordinal: number;
  readonly transport: "attempted";
  readonly result:
    | { readonly state: "returned"; readonly response: string }
    | { readonly state: "failed"; readonly code: string; readonly message: string }
    | { readonly state: "interrupted" };
};
type AuditCall =
  | {
      readonly ordinal: number;
      readonly operation: "score" | "classify" | "extract" | "batchClassify";
      readonly state: "rejected";
      readonly transport: "not-sent";
      readonly failure: AuditFailure;
    }
  | {
      readonly ordinal: number;
      readonly operation: "score" | "classify" | "extract" | "batchClassify";
      readonly state: "admitted";
      readonly request: string;
      readonly attempts: readonly AuditAttempt[];
      readonly result:
        | { readonly state: "completed"; readonly output: string }
        | AuditFailure
        | { readonly state: "interrupted" };
    };
interface ScoreMatchAudit {
  readonly kind: "chat";
  readonly definition: {
    readonly version: string;
    readonly config: string;
    readonly digest: string;
    readonly limits: { readonly maxCalls: number; readonly maxMaterialBytes?: number; readonly contextWindow?: number };
  };
  readonly input: string;
  readonly calls: readonly AuditCall[];
  readonly result:
    | { readonly state: "measured"; readonly value: number }
    | AuditFailure
    | { readonly state: "interrupted" };
}
```

传输 envelope 的完整形状为：

```ts
interface ScoreMatchAuditEnvelope {
  readonly manifest: {
    readonly byteLength: number;
    readonly digest: string;
    readonly chunkByteLengths: readonly number[];
  };
  readonly content: readonly string[];
}
```
content 每块最多 4 KiB，拼接后是 ScoreMatchAudit 的 canonical JSON；digest 是拼接字节的 SHA-256。

成功输出保存经严格校验的完整结构化原语结果。
AuditAttempt 的 response 保存完成读取的原始 HTTP 响应文本，不做 canonical 重编码。
传输失败保存具名失败；没有完整响应时不伪造返回值。
请求内容在重试间不变，各次尝试通过调用序号和尝试序号关联。
审计中的 measured 必须与 entry 的最终 measurement 相等；不完整步骤不能同时出现正常测量终态。

Query 与 View 共用严格 decoder，验证精确字段、canonical 编码、摘要、字节预算、序号、输出和终态一致性。
当前 exact Schema 验证审计材料，损坏为 invalid。旧数据在 Record 格式准入时拒绝。
审计采用独立协议和 criterion，不改写既有 Record，不增加另一种持久 family。
旧 reader 遇到未知 criterion 只把对应 entry 标为 unsupported；其余既有事实继续可读。

## 原语与算法

框架提供 score、classify、extract 和 batchClassify 四个窄原语。
它们共享 Provider、重试、取消、预算与留存，不执行模型生成的工具或代码。
聊天协议的输入材料只进入不可信 user 内容，评价规则进入 system 内容。TypeSafe 的材料进入 state，规则进入 questions。

模型输出使用封闭 schema 严格解码；原语之外的映射和聚合由代码执行。配置静态校验不发网络请求。
模型或 key 不可用也不进入网络路径。费用、预算、重试、审计、timeout 与取消都属于这条 Assertion 路径，
不建立探测请求或探测缓存。
以下是四种原语的穷尽结果形状，未知字段拒绝。AuditCall.result.output 按 operation 保存对应结果的 canonical JSON。

```ts
interface LlmScoreResult {
  readonly measurement: number;
  readonly rationale: string;
}
interface LlmClassifyResult {
  readonly choice: string;
  readonly rationale: string;
  readonly citations?: readonly string[];
}
interface LlmExtractResult {
  readonly items: readonly string[];
  readonly complete: boolean;
  readonly rationale: string;
}
interface LlmBatchClassifyResult {
  readonly items: readonly {
    readonly id: string;
    readonly choice: string;
    readonly rationale: string;
  }[];
}
```

measurement 必须是有限 [0,1]，rationale 和提取项必须为非空文本。
choice 必须精确属于该请求的 choices；extract 数量不得超过该请求的 maxItems，上限为 32。
batchClassify 必须恰好包含请求的全部唯一 ID，结果顺序可不同，不能重复、遗漏或增加 ID。
complete=false 是合法提取响应，但该必要调用以 unavailable 结束，并在审计中保留原始响应。

分类的合法标签和标签到分数的映射进入冻结配置。
`binaryJudge` 使用 `classify` 的 `satisfied` / `not-satisfied`，由代码映射为 1 / 0。它与 `defineJudge` 共享 `defineScoreMatch` 的登记、材料冻结、预算、取消、Provider 和审计；实际 rubric、choices 与分数映射进入 recipe identity。
二值保证来自 exact choice 解码与代码映射，不来自两个 score anchor。无效 choice 沿用原语解码错误，不通过四舍五入产生合法分数。

两答案比较以候选答案为计分方向：候选优于参考为 1，平局为 0.5，参考更优为 0。
该分数表达本次偏好判定，不声称是胜率或消除了位置偏差。

Faithfulness 先提取最多 32 条陈述，再用一次 batchClassify 检查全部陈述。
代码分配稳定的调用内 ID；分类结果必须对每个 ID 恰好返回一项，重复、遗漏和未知 ID 都是 errored。
extract 输出必须包含 `complete: boolean`，表示模型是否完成了本次提取；false 为 unavailable，不能截取前 32 条并声明完成。
超出提取上限为 errored；零陈述为 unavailable。
最终分数由代码计算 supported / total，完整分母与每项判定保留在原语输出中。
模型对陈述的抽取与支持性判断仍可能出错，框架不把这个比例解释为事实正确性的证明。

## Agent Judge

Agent Judge 的公开定义与工具行为单源在 [Library](library.md#agent-judge--在-sandbox-里自己取证再评分)。
它是内建受管 ScoreMatch 的独立算法，不是第五种允许执行任意代码的 LLM 原语。
四个窄原语仍只处理冻结材料；工具执行能力只授予当前 Agent Judge entry，普通 callback 不能取得 Sandbox 句柄。

### 材料、调度与归属

登记时冻结的 subject 只是开场上下文，不能解释成 Sandbox 快照。
每次工具调用留存的是该时刻的现场观察；后续写入可以改变现场，但不能回写 subject、已封存的 diff 或早先工具结果。
取证工具、提交工具及其 schema 与提示模板共同由 Judge owner 管理。

封口调度把待求值 entry 稳定分成普通断言与 Agent Judge 两组。
先完成普通组，再按评审会话的登记顺序串行执行，一次会话结算它的全部评分题。
entry identity、展示顺序和账本 entryIndex 仍按原登记顺序。

已求值 entry 复用 settlement，不重复执行。无 Agent Judge 时维持既有调度语义。
普通断言的 stop 屏障只结算普通组，不触发 Agent Judge；Agent Judge 自身挂 `.stop()` 是登记错误。
声明 State、共享 Sandbox 的 Eval Group 或 `sandboxReuse` 的配对在规划阶段拒绝 Agent Judge（`judge.agent-shared-sandbox`），评审的写入因此只落在本 Attempt 独占、随后销毁的现场。
不能只依靠作者把 Judge 登记在最后来保证此顺序。

Runner 在 workspace.diff 冻结之后交出当前主 Sandbox 的短期能力，在 Agent runtime teardown 与 Sandbox release 之前收回。
工具调用归属于 assertions.evaluate 下的对应 entry；不走被测 Agent Adapter 的 send 或事件归一入口。
模型用量只进入 Judge collector，不进入 t.usage。评审产生的命令与 trace 不能被当作应用工具事件或被测 agent 的改动。
telemetry.collect 可以继续收口被测应用的迟到数据，但必须按事件 producer 隔离评审活动。

### pi coding agent 与受管 Provider

Agent Judge 就是一个 pi coding agent 会话：NiceEval 只追加 system prompt、提供 Sandbox operations 与评分工具，其余全部是 pi coding agent 的行为。NiceEval 不实现自己的 bash/read/write/edit，不包装模型请求，不另写压缩或重试。

- 宿主用 `@earendil-works/pi-coding-agent` SDK 的 `createAgentSession` 创建会话。模型只从受管 Provider 生效配置注入：Chat Completions endpoint、headers、模型 ID、凭据，`maxOutputTokens` 作为 maxTokens。不使用 pi 默认的 provider 注册表、`~/.pi` 凭据或宿主进程变量。
- 上下文上限按 [`contextWindow`](library.md#工厂与类型) 的规则取得：先用显式值，再按模型名查内置模型目录，都没有时传一个不会触发阈值压缩的值，只靠 pi 的溢出恢复。
- 会话与宿主隔离：settings 与 session 使用内存实现，资源加载关闭全部发现（context files、skills、extensions、prompt templates、MCP），不读写宿主的 pi 配置目录。
- 内置 `bash`、`read`、`write`、`edit` 通过 pi 的 `BashOperations`、`ReadOperations`、`WriteOperations`、`EditOperations` 接到当前 Attempt 主 Sandbox；其它内置工具不启用。`submit_evaluation` 是 `customTools` 里的自定义工具，参数校验由 NiceEval 负责。
- 每道 `chat`、`judge` 或 `grade` 是同一个会话上的一次 `prompt()`，后面的题能看到前面的历史。以 `agent_settled` 判断 pi 不会再自动继续。
- 取消与期限用会话的 `abort()`，并终止在途 Sandbox 命令。
- 工具结果只作为不可信 tool 内容返回，文件、命令输出和模型文字都不能升级成 system 规则。
- 所选模型的工具能力由实际请求验证，不额外发探测请求。TypeSafe 在创建会话之前拒绝，零发送，结果 unavailable。

### 上下文与压缩

上下文与压缩完全交给 pi coding agent：超过阈值时自动压缩，模型报告溢出时由 pi 做一次压缩后重试。NiceEval 不补任何压缩逻辑，只读取结果：

- 压缩与重试不消耗当前评分题的 `maxTurns`。已提交的评分题保存在会话之外，不受压缩影响。
- pi 的溢出恢复仍失败、这道题因此结束而未提交时，当前与之后的评分题为 `unavailable`（`agent-judge-context-overflow`），已提交的题保留各自的 measurement。

### 用量、审计与预算

- 用量直接取 pi coding agent 会话报告的 usage（含压缩摘要请求），按受管 Provider 的显式估价计价，记入 Judge 用量（operation `agent`）。NiceEval 不逐次保存 HTTP 尝试；pi 内部的重试只体现在 pi 报告的 usage 里。
- 审计保存 pi session 的完整内容：开场消息、每条 user / assistant 消息、工具调用参数与有限结果、pi 的压缩条目（摘要文本、压缩前 token），以及每道题的提交。它就是评审实际看到的对话，不是另行重建的请求副本。
- `maxTurns` 计每道题的 assistant 轮次，替代 maxCalls。整次会话的期限取定义的 `timeoutMs` 与 Attempt 剩余期限的较小值。
- 审计不设字节上限，也不计入 Attempt 的文字材料与 audit 总账：完整的 pi 会话经受管 Content 分块保存，读取由 Inspection 分页。只有存储写入本身失败才影响结果，归为 errored；不因会话大小判 unavailable，也不截断对话。
- bash 与 read 的截断发生在形成工具结果之前，模型与审计看到同一个有限结果。
- 第一次合法提交锁定这道题的分数；同批后续工具与迟到的提交不能重新打开它。命令非零退出、文件不存在和非法提交是可纠正的工具结果。
- 失败按发生在哪一层分类，不按错误文案匹配：
  - pi 会话接口抛出的异常（创建会话、发送、工具注册等不变量被破坏）是框架 defect，结果为 errored。
  - 以 assistant 消息结算且 `stopReason` 为 `error` 的回合，是 pi 用尽自身重试后报告的最终请求失败，结果为 unavailable（`judge-call-failed`）。
  - pi 会把畸形的模型响应折进同一种消息，NiceEval 无法把它与网络失败区分，同样按最终请求失败处理，pi 给出的原始错误文字保留为证据。
  - NiceEval 自己能判定的协议损坏为 errored，例如 pi 报告的 usage 结构不合法；提交参数不符合 schema 是可纠正的工具结果，不在此列。
  - 上下文溢出只依据 pi 的 `isContextOverflow` 判定与 pi 的压缩失败事件，NiceEval 不另维护溢出文案表。
  - 期限与未提交为 unavailable。由本次取消或期限触发的 `aborted` 按取消或超时处理，Attempt 取消保持 interruption；不是本方触发的 `aborted` 按最终请求失败处理。
- 失败分类属于 Agent Judge 的运行时行为，进入使用 Agent Judge 的 Eval 的身份（`agentJudge.algorithm`），未使用者身份不变。

### 审计与历史读取

工具往返使用独立 criterion 与当前审计 Schema。审计不携带 protocol 或 schemaVersion。
它复用 Content 分块与摘要机制，不将工具调用写入 其它审计变体的封闭 operation 枚举。
既有审计 schema、图片捕获与读取解释不变；Agent Judge 的图片开场材料仍走受管图片 Content，不能把 bytes 写进普通 JSON。

一次会话的轨迹（definition、input、chat 消息、generations、tools）只写一份，归属于会话的首个评分题 entry；其余评分题 entry 的审计引用这份轨迹的摘要，只各自保存题型、判据或 prompt 与 anchors、submission 与 result。
读取任一评分题的 detail 都能取到完整轨迹；轨迹缺失或摘要不符时，该题的审计为 invalid。所有序号从 1 连续递增，工具引用使用模型实际 call id。

轨迹不设大小上限，读取不能依赖一次查询装下它：

- `attempt.assertion.detail` 的 full 模式只返回轨迹的 Content 引用（稳定 ID、字节数、摘要）以及题目自己的 submission 与 result，同一份轨迹在一次响应里只出现一次，不内联展开。
- 完整轨迹经 `attempt.trace.detail` 按页读取，分页与读取上限与模拟用户会话相同；Query 的固定结果上限不因轨迹变大而提高。
- `show @<locator> ae_<id> --full` 按页取回并渲染完整轨迹。

普通 Judge 的审计与材料同样不设大小上限、按同一方式读取：`attempt.assertion.detail` 对超过内联上限的审计与材料只返回 Content 引用（稳定 ID、字节数、摘要），完整内容经同一条 `attempt.trace.detail` 分页路径读取。全部 Judge 只有这一种读取大内容的方式。

| 事实 | 内容与验证 |
|---|---|
| definition | 算法 version、canonical config、digest，以及有效 turns、期限和字节限制 |
| input | 冻结开场材料；图片保留受管 Content 描述符、摘要和初始位置 |
| generations | 每轮 ordinal、pi 的 assistant 消息与 usage、具名失败 |
| tools | 所属轮次、call id、name、原始 arguments、校验结果、执行状态、实际有限结果与截断事实 |
| submission | 该评分题第一次合法的 SubmitEvaluationInput 与对应轮次、call id；未提交为 null |
| result | measured、AuditFailure 或 interrupted；measured 必须与 submission 和 entry measurement 一致 |

工具执行状态区分 completed、failed、interrupted 与 not-started。
截断事实含字节上限、实际保留范围与 truncated；未知原始总长记为未知，不能捏造完整字节数。
工具参数校验失败保留原始参数与错误；不能先规范化成合法输入再保存。
每轮请求的历史必须与前轮响应和已执行工具结果一致；合法提交之后不得出现新传输或工具执行。
完整终态要求提交与执行轨迹均可严格校验，不能只相信 rationale 或 evidence 的自由文本引用。

Query、Show 与 View 共用严格 decoder，验证精确 schema、摘要、序号、call id 关联与终态。
未知第三方 criterion 为 unsupported，当前审计形状损坏为 invalid。
预算不足、零发送、非法提交修正与取消均保存可解释终态，不伪造完整分数。

Judge 用量给 Agent Judge 每轮模型生成使用独立 operation `agent`。
`niceeval.judge-usage` 的当前 operation 枚举包含 `agent`；旧数据由整个 Record 格式标记拒绝。
logicalOrdinal 对应生成轮次，transmissionOrdinal 对应该轮实际 HTTP 尝试；工具调用不增加模型请求计数。
费用、失败和取消的结算独立于审计写入，审计写入失败不能抹去已发请求。

### 身份与缓存

定义摘要纳入规范化 instructions 与所有预算；每道评分题的题型（是否或打分）、判据或 prompt 与 anchors 进入它自己的 entry 定义、实际系统提示与工具 Schema 的内容摘要，以及一个执行行为计数。
pi 依赖的可达版本由既有依赖闭包身份追踪；影响执行的适配算法改变还必须更新 owner revision。
有效 Provider、模型、端点、执行限制与凭据声明位置沿用 Eval × Experiment 的求值身份，不保存凭据值及其 hash。
评审中读到的文件与模型输出是结果事实，不追加入执行前 identity。

新增 ScoreMatch 类型不能仅靠运行时登记的 digest 声称 Eval 已正确重规划；规划端须从既有源码闭包和声明配置捕获定义输入。
Agent Judge、普通 Judge 与模拟用户各保留一个不能由文本表达的行为计数，只进入依赖该能力的 Eval 身份。
系统提示、工具说明、提交 Schema 与内置判据按实际内容求摘要；变更后的受影响 Eval 重新执行。
NiceEval 组件变化由 [身份 manifest](../experiments/architecture/cache.md#niceeval-身份域变更)解释，不要求历史身份重建。

历史结果保持原解释，不能因新 reader 支持 Agent Judge 就重写历史 measurement 或材料。

## Provider 求值与身份

公开工厂和配置优先级单源在 [Library](library.md#runtime-配置)。Provider 是带运行时构造凭据的冻结值，
私有执行能力与秘密不进入公开枚举属性。普通结构相似对象不能通过构造凭据校验。

每个 Eval × Experiment 先找到最高优先级的完整 Provider，再应用其上方的模型字符串。
同一份求值结果同时供计划身份和实际执行消费，Runner 不重新选择端点或读取另一家凭据。
Provider 不拥有 Assertion 生命周期，也不建立自己的 Effect runtime、探测请求、retry 或 timeout。

```ts
interface JudgeProviderIdentity {
  readonly provider: "openai" | "vercel" | "openrouter" | "typesafe";
  readonly model: string;
  readonly baseUrl: string;
  readonly credential: { readonly kind: "inline" } | {
    readonly kind: "environment";
    readonly name: string;
  };
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly protocol:
    | { readonly kind: "chat-completions"; readonly maxOutputTokens: number }
    | { readonly kind: "typesafe-system-one" };
}
```

该形状是可留存的配置投影，不是可恢复的 Provider 对象。Provider kind 与 protocol kind 必须匹配。
归一化 endpoint、最终模型、凭据声明位置、执行限制与 protocol kind 共同进入配置摘要、fingerprint、字段差异和实际执行投影。
凭据值及其 hash 不进入这些投影；更换 key 值不构成评分算法变化。

历史配置只按其原协议读取，不自动变成新 Provider。历史结果缺少当前 Provider identity 时不能取得当前配置的复用资格。
RunContext 仍遵守所属严格 schema；新增身份只进入其正式 owner，不能在写入时夹带未声明字段。
影响执行的映射算法变化进入 NiceEval 实现身份，使相关结果重新求值。

## TypeSafe 请求与解码

TypeSafe 传输只发送 `{ model, state, questions }`，endpoint 后缀为 `/systemone`。
state 保存 canonical 材料；批量分类的 state 还保存全部 item。问题 ID 为调用内稳定的 `q0`、`q1` 等，
instructions 只包含 rubric、材料不可信声明和指向 state item 的索引，不把 item 文本提升为规则。

Score levels 按 anchor 顺序发送 description；adapter 用完整概率分布与原始 measurement 求加权和。
Choice labels 原样保留；批量问题与 item ID 建立完整一一映射，响应不得增加、遗漏或重复问题。

响应先经过字节上限，再解码封闭的 answer schema。概率键必须与请求等级或类别精确相等，值和 confidence
必须为有限 `[0,1]`；概率总和与 1 的绝对误差不超过 `1e-6`，仅在该容差内按总和归一化用于计算。
Score 返回的等级索引期望必须与 probabilities 在 `1e-6` 内一致；Choice 的选中项必须属于最高概率项，平局允许任一最高项。
Score legend 必须与实际请求的各等级描述一致。model 与 usage 保留为服务返回事实，不据 model alias 字符串相等断言失败。

超过能力范围的调用在准入前锁存 `judge-capability-unavailable`，不创建传输尝试。
TypeSafe 不生成自由文本理由；规范化 rationale 的固定前缀说明它是 NiceEval 生成的返回值摘要。
confidence 不参与 measurement、gate 或 contribution，也不被解释为判断正确率。

## TypeSafe 审计

当前审计按实际调用种类区分：聊天为 `kind: "chat"`，TypeSafe 为 `kind: "typed"`，图片为 `kind: "images"`。
manifest 只保存长度、摘要与分块事实，不重复记录调用种类或格式标记。

```ts
type PrimitiveOptions<K extends keyof ScoreMatchContext["llm"]> =
  Parameters<ScoreMatchContext["llm"][K]>[0];
type TypeSafeMapping =
  | { readonly operation: "score"; readonly input: PrimitiveOptions<"score"> }
  | { readonly operation: "classify"; readonly input: PrimitiveOptions<"classify"> }
  | { readonly operation: "batchClassify"; readonly input: PrimitiveOptions<"batchClassify"> };
type TypeSafeAuditCall =
  | Extract<AuditCall, { readonly state: "rejected" }>
  | (Omit<Extract<AuditCall, { readonly state: "admitted" }>, "operation"> & {
      readonly operation: TypeSafeMapping["operation"];
      readonly mapping: TypeSafeMapping;
    });
interface TypedScoreMatchAudit extends Omit<ScoreMatchAudit, "kind" | "calls"> {
  readonly kind: "typed";
  readonly calls: readonly TypeSafeAuditCall[];
}

```

`mapping.input` 是本次原语调用的冻结 canonical 快照，包含实际 anchors 数值或完整 item IDs。
它与 request、response、output 一起计入审计预算，不能假定高级 callback 的动态输入等于 definition.config。
question IDs 按 input 顺序派生；mapping.operation 必须等于 call.operation。

TypeSafe reader 验证 mapping 与真实请求一致、响应包含全部必要结果，并从最后一次成功响应重算规范化 output。
分数、类别、rationale 或逐项映射不一致均为 invalid；失败或中断调用不能伪造 completed。
Definition digest 表示 Match 算法定义；Provider identity 保留实际传输配置，NiceEval 实现身份约束映射解释。
所有审计变体都保存实际 HTTP 请求正文，不用伪造的 Chat Completions envelope 替换 TypeSafe 事实。

## 验收边界

安装后公开入口证明自定义与内建 Match 都能通过 check 使用，judge 糖不会增加 entry 或调用。
确定性 Provider 边界验证分类映射、完整分母、catch 后失败锁存、预算拒绝零发送和取消后禁止后续发送。
公开 Assertion detail 验证当前审计与材料读回；畸形材料必须明确拒绝。
模型判断质量属于真实模型校准，协议 fixture 的通过不能代替它。

Provider 验收包含四个工厂的公开导入、凭据声明位置、模型替换与整体替换、TypeSafe 非等距 anchor 分数和能力拒绝。
同一结果经公开 Assertion detail 读回聊天与 TypeSafe 审计；动态 anchors、批量 ID、畸形概率与超限响应具有独立的可观察失败。
迁移错误在相关业务动作之前交付位置与英文指南；历史结果读取与旧源码配置拒绝分别验收。

## 图片捕获与 Content

含图片的受管材料使用 `judgeImage` 的不可伪造值；同步复制 bytes 保存在私有 WeakMap，
callback 只能重用不透明值，不能取得可修改数组。捕获遍历保留原有 JSON 校验，
仅在材料位置承认图片；definition config、rubric、anchors 和其它原语字段仍是严格 JSON。
高级原语的 material 类型为递归 `JudgeMaterial`。动态步骤只能引用本 entry 登记时捕获的图片，
迟到图片与普通 JSON 冒充引用不授予读取能力。初始图片位置使用 JSON Pointer 留存。

每个 entry 最多 4 个实际图片引用、8 MiB raw bytes；单图 4 MiB、16,777,216 pixels。
每个原语构造的实际图片 parts 再次检查同样上限，不能通过重复引用放大。
PNG/JPEG 校验签名、header 长度与尺寸及 MIME 一致性；这不是完整像素解码。
登记点同时检查既有 512 KiB 文本总账与独立 32 MiB 图片总账，全部通过才创建 entry 和扣账。
跨 entry 重用仍分别计费到图片留存，不跨 entry 共享 Content handle。重试复用同一 wire body，不重复封存图片。

图片各自作为 Assertions 自有 binary Content 写入，最后一项 evidence 始终为审计 JSON。
不新增持久 family，也不向作者公开 blob reference。取消或未发送仍保留已登记图片。
图片变体只取决于捕获材料中是否有图片；零发送拒绝也保存图片描述符。
纯 JSON 按实际聊天或 TypeSafe 调用保存。

图片审计使用 `kind: "images"`。
沿用 definition、input、result 与拒绝 call；新增 images 描述符列表，每项含本 entry 内稳定
imageId、evidenceIndex、mediaType、byteLength、sha256 与初始材料 paths。
已准入 call 不再把模板叫 request，而使用 requestTemplate 与 wireBody（byteLength、sha256），
其它 ordinal、operation、attempts、result 与聊天审计相同。

requestTemplate 是 canonical JSON：唯一 user content 数组首项为 canonical JSON text，
图片位置使用 `image_url.url = "niceeval-image:<imageId>"`。
同一模板只在这些类型化 image_url 位置替换为 `data:<mediaType>;base64,<RFC4648 bytes>`，
再按既有 canonical JSON 和 UTF-8 生成唯一 wire body；先计算摘要，再把同一正文交给 transport。
文本中同名字符串不参与替换。图片顺序与文本中的 imageId 对应，不把图片说明提升为 system 规则。

描述符、模板和终态完整写入审计；raw bytes 计入图片总账；base64 膨胀后的 wire body
受原语图片上限和材料/规则上限共同约束。已提交图片不得被静默删去。

审计读取必须验证 imageId 唯一、evidence ordinal、Content digest/length、MIME 和封闭引用，
按相同序列化规则还原发送正文并核对 wireBody。缺图、错位、伪引用、摘要不符均不可返回 available。
旧数据在 Record 打开时拒绝。人读界面将 requestTemplate 明确呈现为模板，不冒充 wire 原文。

## 有界图片读回

多模态 Assertion detail 只交付图片 metadata 与已解码审计；不重复展开 source/evidence 的
大图或原始 audit base64。单次结果仍受 512 KiB 上限约束。
固定 `attempt.assertion.image` 只允许本 locator/entryId 内的 imageId，接受 offset/limit，
最多返回 256 KiB raw bytes 的 base64、整图 SHA/byteLength/mediaType、offset、nextOffset。
分页与 detail 使用同一封存 cutoff；不接受路径、URL、外部 Content handle 或跨 entry 引用。

CLI 与 Web 使用同一 operation 和 decoder，搬迁 Record 后无需原附件目录或模型服务。

图片能力为聊天 Provider 的显式 supportsImages 声明，默认 false，进入执行身份、
fingerprint 与字段差异。字符串模型 override 继承声明，作者负责最终模型实际支持视觉和 forced tool；
完整 Provider 替换采用新声明。能力拒绝先于凭据读取和 wire 构造，不能由缺 key 遮蔽。
服务实际拒绝沿用原错误分类，不降级为文本调用。

验收使用确定性 HTTP fixture 捕获真实 body，核对 image parts、冻结 bytes 与离线还原摘要；
验证大图详情有界、Record 搬迁分页、无能力零发送、晚到图片/重复引用限制、
重试取消封口及 聊天与 TypeSafe 读回。图片只参与作者主动选择的语义判据，不自动产生断言或 gate。

## 匹配材料的整组问答

`closeQA(materialMatch, question)` 在登记处注入当前 receiver ctx，同步捕获 reader 事实，并用既有 Boolean Match 对同一候选求值。
匹配与发送快照、私有 owner 校验和无模型终态收据由 [Assertions Evidence](../assertions/architecture/evidence.md#上下文材料的两类快照) 拥有。
receiver 的开放事务与取消顺序见 [Run 生命周期](../run/architecture/lifecycle.md#材料-receiver-与-judge-封存)，不建立 source binder 或全局 callback registry。

源完整、捕获穷尽、全部 predicate 可判定且命中集合非空时，全部命中材料保序交给一次 classify。
satisfied=1，not-satisfied=0，insufficient-evidence=unavailable。
完整零命中为 0、零调用；partial、unknown 或容量不足为 unavailable，不能截断材料继续评分。
实际输入只有 question、全部命中原文及身份和完整 selection receipt；业务失败或未采用项不被预先过滤。
材料只是数据，不能改写 rubric 或引入外部知识。

调用复用同一 entry 的失败锁存、配置、预算、timeout、signal、usage 和审计，不创建第二个 runtime。
无模型终态保留 question、source、原因与 evaluation.receipt，不声明不存在的请求。
中断先关闭进度写入，再封口选择计数；晚到 callback 不修改已封存 entry。

### 引用与严格审计

classify 只有显式 evidenceIds 时才请求引用；最多 16384 个唯一 ID，每个最多 128 UTF-8 bytes。
聊天 response 必须含无重复的 citations 数组，且所有成员属于命中 ID 集；空数组表示模型实际返回空引用。
聊天审计 reader 同时 exact decode 请求、原始 response 与 output，并验证 ID 子集，不能只验证最终映射。
TypeSafe mapping reader 验证可选 evidenceIds 与映射；wire 不请求其没有的引用能力，output 不带 citations，读面标记 not-recorded。
未请求引用的原语保持原结果形状，不生成引用。

ScoreMatch measured/unavailable 可保留实际 rationale 与 citations，insufficient-evidence 同样保留它们。
受管 gateway 与 Inspection 只保存真实返回值；Provider 失败已锁存时，callback 不能伪造正常结果恢复。

## Judge 物理用量账本

每个已执行 Attempt 拥有独立 Judge collector；应用与 Agent 的所有 Assertion scope 共用该 owner。
它统计 NiceEval 实际发起的 HTTP 传输，重试各计一次，不把逻辑原语次数、模型、QA 结果或 Provider response ID 当去重键。
账本与评分审计分开封存，使失败费用不依赖材料大小或审计正文解码。

### 调用身份

每个已执行 Attempt 恰有一个私有 Judge collector。Assertion runtime 从它获得绑定 entryIndex 的能力，所有 scope 共用。
物理键是 originRunId + originAttemptId + judge + entryIndex + logicalOrdinal + transmissionOrdinal。

局部 callId 为 `judge:<entryIndex>:<logicalOrdinal>:<transmissionOrdinal>`。entryIndex 从 0 开始，另两项从 1 开始。
登记时固定 entryIndex，延迟 material QA 只使用该能力，不在求值完成后读取 entries.length。

发布时使用同一次 PreparedAssertionsAttachment.entryIds 将 entryIndex 绑定为 entryId，账本保存该正式 ID。
entryId 使用正式 AssertionEntryId Schema；引用不一致为发布错误，不能把数组序号当 detail identity。

Query call 保留 entryId，客户端通过当前 Attempt locator 与 entryId 调用 assertion.detail；origin 由现有身份查找固定。
若详情读取不可用仍保留账本金额和调用行，不能据此抹去费用。
不以模型、Provider、QA 结果、响应 ID 或引用 Run 去重。只登记 NiceEval 发起的 HTTP 请求，不推断网关内部重试。

### 持久形状

Attempt family `niceeval.judge-usage` 使用当前 exact payload，沿用 Record family 存储，不改写历史应用 usage family。
附件通过现有 attachment manifest/body 事务随 Attempt 发布；官方 family 的格式准入由 Record 统一拥有。

```ts
interface JudgeUsageCall {
  callId: string;
  entryIndex: number;
  entryId: string;
  logicalOrdinal: number;
  transmissionOrdinal: number;
  operation: "score" | "classify" | "extract" | "batchClassify";
  requestModel: string;
  transportProvider: "openai" | "vercel" | "openrouter" | "typesafe";
  provider: string | null;
  model: string | null;
  status: "succeeded" | "failed" | "cancelled" | "unknown";
  httpStatus: number | null;
  inputTokens: number | null;
  inputTotalTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: { amount: string; currency: string; source: { kind: "reported"; id: string } } | null;
  receipt: {
    state: "available" | "unavailable";
    reason: string | null;
    responseDigest: string | null;
    fields: readonly { path: string; value: string | number | null }[];
  };
}
interface JudgeUsageAttachment {
  collection: CollectionState;
  calls: readonly JudgeUsageCall[];
  priceReceipts: readonly JudgePriceReceipt[];
}
```

requestModel、响应 model 和价证 selector 均最长 8192 UTF-8 bytes，保留 Provider 的现有合法输入。
其它身份最长 256 bytes，数值数量为非负安全整数，金额为既有 canonical decimal，币种用既有 CurrencyCode。
不得截断 requestModel 或价证 selector。超长响应 model 记 null 和固定限制原因，不影响独立有效的 token/费用。

HTTP status 为 100–599 或 null。callId 必须由三个序号生成，唯一；同一步重试 ordinal 连续，不跨 entry。
collection complete 说明全部进入边界的请求已登记，不保证远端物理完成或费用已知。
待决请求内部保留 pending，发布前投影 unknown；取消表示本地终止等待，不证明服务端停工。

receipt 只保存白名单字段及完整有界响应的 SHA-256，不保存 Authorization、URL、headers、任意错误消息或业务正文。
fields 最多 24 项，path 最长 128 bytes，字符串值最长 8192 bytes，receipt 最多 32 KiB。
白名单 path 唯一并按字典序排列；只保留已验证的 scalar 字段，不复制 provider error message。

解码非法字段只使对应观察未知，保留固定 reason。receipt available 表示完整 body 可解码且至少一项白名单事实可用。
无 body、取消、超限、非法 JSON、缺少字段分别用 response-unavailable、cancelled、response-too-large、invalid-json、usage-not-reported。
字段值非法用 invalid-usage；独立有效字段仍保留，reason 可与 available 并存。

超大响应不能解码截断 JSON，也不生成完整响应 digest。响应边界保留 httpStatus，费用未知。

### 响应映射

映射只由显式 Provider 协议选择；读取 2xx 与非 2xx 的同层回执，早于 QA 内容解码。
Chat 协议读取 usage.prompt_tokens、usage.completion_tokens、usage.prompt_tokens_details.cached_tokens。

inputTotalTokens 为 prompt_tokens；cache-read 来自 cached_tokens，OpenRouter cache-write 来自 usage.prompt_tokens_details.cache_write_tokens。
只有 read/write 两桶都有明确值且总和不大于 prompt 时，inputTokens 才为 prompt-read-write。

任一 cache 桶缺失为 null，不能把 prompt-cached 当已知 fresh input；省略字段不代表零。
prompt 明确为 0 且没有正数/非法/矛盾子桶时，由非负总量证明 input/read/write 均为 0。
子桶和超过总量或与完整互斥桶不一致时，相关 token 指标未知并保存 invalid-usage；不能制造已知费用小计。

usage.total_tokens 用于一致性核对；totalTokens 由已知 inputTotalTokens+outputTokens 推导，不再加 cache 或 reasoning。
矛盾或负数不静默修正，相关指标未知；其它独立有效费用仍可保留。

Vercel Chat 的 reported 金额与 serving provider 保持未知；Responses 回执不能证明 Chat 的费用路径。
`provider_metadata.gateway.cost` 与 `provider_metadata.gateway.routing.finalProvider` 只属于已核对的 Responses 回执，不授权 Chat 映射。

人工构造的 Chat fixture 只验证 token 与显式 pricing，不作为供应商费用路径的证据。
OpenRouter 的金额读取 usage.cost，币种 USD；serving provider 读取响应 provider。OpenAI 与 TypeSafe 没有正式费用字段时保持未知。
model 只读取响应 model；请求配置单独在 requestModel，不冒充实际模型。transportProvider 永远是显式 Provider 类型。

TypeSafe systemone 读取 usage.input_tokens 为 inputTotalTokens，usage.output_tokens 为 outputTokens，先于 answers 解码。
20/10 回执得到 totalTokens=30；三次传输合计 60/30/90，能力拒绝不增加调用。
其 cache 桶与互斥 fresh input 无证明为 null；费用无已支持字段时仍未知。

金额允许有限非负 number 或 canonical decimal string，number 先走既有精确定点转换；reported 0 永远优先。
这些路径以协议资料和真实 fixture 为证，不按 hostname 或模型前缀推导 provider。

### 显式估价

复用 defineConfig.pricing 的 selector、rates、digest、source、缺桶与定点算法，按 requestModel 选择并封存证明。
选择请求模型表示作者明确接受该配置价格基准，不宣称回退模型实际售价。不得使用未封存的内置价格或读取时重新定价。

Judge validator 将 proof.pricing.requestModel 绑定 call.requestModel，不能沿用应用 validator 与 call.model 的比较。
每 call 至多一条 proof，存在 reported cost 时禁止同 call 的 estimate；proof bucket 与已证明的互斥 token 逐项对应。

缺 reported 才估价；缺桶或缺费率保留 partial，不能用 known subtotal 通过预算。已有 reported 不追加估价。
内部共用纯金额/分桶算法，Judge proof kind 为 judge-call-price-estimate，应用 proof kind 和历史字节不变。

### 容量与封存

collector 使用现有 defineRecordAttachment 正式编码通道，不扩大全局 Record 限制。
上限为 payload canonical JSON 1,048,576 bytes、100,000 nodes、10,000 object keys、深度 64，以及最多 4000 物理调用。

4000 仅为 count 上限，不承诺最坏字段和价证下仍能到达。发送前预留附件 framing、entryId、当前完整 ledger、打开项最坏终态和新项最坏终态。
预留基于已知 requestModel/selector/profile 的实际编码和未知回执字段的明示最大长度，同时核对 bytes/nodes/keys/depth。
不得只预留固定 4096 bytes 元数据。内部共享 Record 当前编码上限和计量，避免两份不同限制。

预留不足则 ScoreMatch unavailable/judge-usage-capacity-exceeded，零新发送；已有项不截断、不采样、不丢弃。
已预留响应字段超界只保存有界 reason 与未知对应字段，不得令终态对象超过预留或拒绝发布已发生的费用。
终态后退还保守预留与实际编码的差额，使正常小回执不会长期占用最坏槽位。
新的已执行 Attempt 即使创建应用失败也发布空账本；未执行或跳过的 Attempt 不虚构 collector。

费用完整只表示已登记 inference 回执或显式估价范围内完整，不是账户账单；网关附加服务费不属于该投影。
响应映射只依赖明确协议与真实回执，不按 hostname 或模型前缀推导 Provider。
公共投影、预览与总计见 [Inspection](../inspection/architecture.md#judge-用量投影)。

## Judge 传输生命周期

1. Attempt 初始化创建 collector，冻结 pricing。应用与 Agent 共享同一拥有者。
2. check 登记时固定 entryIndex，把内部记账能力传入延迟 material QA 或直接受管 ScoreMatch。
3. 每个逻辑步骤完成预算、凭据、协议、材料校验，准备有界请求。此时尚未登记物理请求。

4. 每次 HTTP 重试分别创建 transmission capability。signal 已 abort 则拒绝；否则预留容量、登记 pending，紧接着调用 fetch，中间不 await。
5. transport 收到 headers 立即同步提交 httpStatus；有界 body 完成后同步解码并提交白名单回执，然后才兑现 Promise 供评分解码。

6. 同一个 capability 的 response-commit 与 abort/close 以首次同步发生者为准。已提交 token/cost 不因之后取消或 QA 错误回退。
7. HTTP 非成功、断连或内容错误不删除调用。重试等待不计调用，下一次 fetch 使用新的 transmission ordinal。

8. entry timeout 只关闭该 entry 的全部 capability，禁止该 entry 继续发送，不关闭 Attempt 或其它 entry 的调用能力。
9. Attempt 终止则关闭所有 entry admission 及打开 capability，随后触发 abort；终态前冻结账本，并在 Record 发布时绑定正式 entryId。

### 取消与回执截止

每个 transmission 的唯一回执接纳截止是 body-commit、signal abort、entry close、Attempt close 中最先发生的同步动作。
headers 先到则 httpStatus 可保留；仅 headers 不表示收到 token 或费用。abort 后 body 才返回，即使其它 entry 仍执行，也不得补写该项。

调用状态 succeeded/failed 表示收到完整 HTTP body 的 2xx/非 2xx；2xx 的 QA 内容非法仍是 succeeded 传输。
本地 abort 为 cancelled，终态仍未闭合的项为 unknown；两者都不声称远端物理完成。

上层求值中断会忽略迟到 resume，不能据此认为底层 Promise 已结清。账本写入放在 transport 自己的 capability 回调，不依赖评分任务恢复。
transport 独占 reader、abort listener 和资源释放 Promise；abort 先关闭 capability，再取消 body、释放 reader lock 并移除 listener。

body 读取与 abort 竞争，确保本地读取任务有界结束。取消后的资源释放最多 1000 ms，沿已有 Judge timeout/Attempt 剩余期限取更小值，不延长应用测量。
未结清的 cancel promise 需显式挂 catch，不能留下未处理拒绝；无法证明资源释放完成时保留诊断，不宣称服务端完成。

需要先返回的取消路径仍跟踪资源释放任务，Attempt 封存前在该有界等待期限内等待，不把求值任务的 finalizer 当作底层 Promise 的证明。

物理次数精确定义为 NiceEval 已调用 fetch 的传输尝试；连接建立失败也算一次。网关内重试无法由本机推导。
传输取消与 Attempt cancellation reason 遵守既有 first-winner，不引入新取消协议。
