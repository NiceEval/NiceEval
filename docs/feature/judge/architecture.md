# Judge —— 架构

## 一个 Match 执行协议

`defineJudge` 和现成裁判调用公开 `defineScoreMatch`，返回真实 `ScoreMatch`。
`t.check` 统一准备、登记、执行和封口；`t.judge` 校验受管 LLM Match 后转交同一入口。
Context 不按 Judge 名称或预设名称选择另一条登记路径。
普通数值和 Promise callback 在边界适配为 Effect；高级 callback 直接组合 Effect 与受管 LLM 原语。

Match 不拥有 gate、points、stop、源码位置或 Assertion identity。
这些事实仍由同一个 Assertion runtime 保存，每次 `check` 只产生一个 entry。

## 授权、身份与输入

入口在材料反射前确认 Match 与调用形状；不存在 Eval 的 Match 允许列表。
高级 Match 接收登记时生成的深冻结 canonical JSON 快照，后续调用方修改原对象不会改变输入。
受管 LLM 能力只由框架提供，不是 JavaScript 沙箱。
作者 callback 属于可信项目代码。

高级 Match 显式声明非空 `version` 和 canonical JSON `config`，与名称、预算和协议一起进入定义摘要。
框架同时沿用 Eval 的源码身份；不以 `Function.toString()` 推断隐藏闭包或外部状态。
作者必须把影响评分的参数写入 config，并在算法改变时更新 version。
自定义 criterion 只声明名称和测量尺度，不声称证明 callback 的实际语义。
内置算法的版本、分类映射和配置共同定义它的解释。Judge authoring protocol 的 fingerprint 版本由内置算法
owner 随规则改变维护；它不是历史 durable schema 的迁移信号。

## 预算与生命周期

每个 entry 有独占执行上下文、串行调用序号、失败锁存器和审计容量。
`maxCalls` 计逻辑原语调用，默认 4，上限 16；每个调用最多 3 次传输尝试。
裁判 Provider 的 timeout 限定该 entry 的整个高级 callback、全部步骤、重试和等待，不能每步重新获得完整期限。

`maxMaterialBytes` 默认 32 KiB，上限 48 KiB。
`maxAuditBytes` 默认 96 KiB，上限 256 KiB，包含序列化审计材料与封口事实。
登记时从 Attempt 的 512 KiB 总账原子预留初始材料实际字节与完整审计容量。
登记失败不创建 entry，也不调用 callback 或 Provider。

每步发送前再次检查剩余容量，预留实际请求、响应硬上限和最多三次尝试的留存。
终态事实空间提前保留。已准入请求完整留存；未准入请求只保存 not-sent、拒绝原因和有界元数据。
预算不足时不能发送后再裁剪证据，也不能把部分步骤的结果当完整分数。

执行期预算拒绝、最终传输失败、超时和零陈述锁存 unavailable；非法输出、ID 错误和 callback defect 锁存 errored。
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
  readonly schemaVersion: 1;
  readonly protocol: "niceeval.score-match-audit/v1";
  readonly definition: {
    readonly name: string;
    readonly version: string;
    readonly config: string;
    readonly digest: string;
    readonly limits: { readonly maxCalls: number; readonly maxMaterialBytes: number; readonly maxAuditBytes: number };
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
    readonly schemaVersion: 1;
    readonly protocol: "niceeval.score-match-audit/v1";
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
未知协议为 unsupported，损坏为 invalid。历史 v1/v2 Judge 材料保持原有解释与读取路径。
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
两答案比较以候选答案为计分方向：候选优于参考为 1，平局为 0.5，参考更优为 0。
该分数表达本次偏好判定，不声称是胜率或消除了位置偏差。

Faithfulness 先提取最多 32 条陈述，再用一次 batchClassify 检查全部陈述。
代码分配稳定的调用内 ID；分类结果必须对每个 ID 恰好返回一项，重复、遗漏和未知 ID 都是 errored。
extract 输出必须包含 `complete: boolean`，表示模型是否完成了本次提取；false 为 unavailable，不能截取前 32 条并声明完成。
超出提取上限为 errored；零陈述为 unavailable。
最终分数由代码计算 supported / total，完整分母与每项判定保留在原语输出中。
模型对陈述的抽取与支持性判断仍可能出错，框架不把这个比例解释为事实正确性的证明。

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
    | { readonly kind: "chat-completions"; readonly revision: 1; readonly maxOutputTokens: number }
    | { readonly kind: "typesafe-system-one"; readonly revision: 1 };
}
```

该形状是可留存的配置投影，不是可恢复的 Provider 对象。Provider kind 与 protocol kind 必须匹配。
归一化 endpoint、最终模型、凭据声明位置、执行限制和映射 revision 共同进入配置摘要、fingerprint、字段差异和实际执行投影。
凭据值及其 hash 不进入这些投影；更换 key 值不构成评分算法变化。

历史配置只按其原协议读取，不自动变成新 Provider。历史结果缺少当前 Provider identity 时不能取得当前配置的复用资格。
RunContext 仍遵守所属严格 schema；新增身份只进入其正式 owner，不能在写入时夹带未声明字段。
协议 revision 变化使相关结果重新求值，不能在旧 identity 下静默改变 TypeSafe 映射算法。

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

## TypeSafe 审计 v2

聊天协议继续写 v1；TypeSafe 写 schemaVersion `2`、protocol `niceeval.score-match-audit/v2`。
reader 同时识别两个版本，v1 的字段与解释保持不变。旧 reader 遇到 v2 返回 unsupported，不能把它误认成损坏的 v1。

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
interface ScoreMatchAuditV2 extends Omit<ScoreMatchAudit, "schemaVersion" | "protocol" | "calls"> {
  readonly schemaVersion: 2;
  readonly protocol: "niceeval.score-match-audit/v2";
  readonly calls: readonly TypeSafeAuditCall[];
}
interface ScoreMatchAuditEnvelopeV2 extends Omit<ScoreMatchAuditEnvelope, "manifest"> {
  readonly manifest: Omit<ScoreMatchAuditEnvelope["manifest"], "schemaVersion" | "protocol"> & {
    readonly schemaVersion: 2;
    readonly protocol: "niceeval.score-match-audit/v2";
  };
}
```

`mapping.input` 是本次原语调用的冻结 canonical 快照，包含实际 anchors 数值或完整 item IDs。
它与 request、response、output 一起计入审计预算，不能假定高级 callback 的动态输入等于 definition.config。
question IDs 按 input 顺序派生；mapping.operation 必须等于 call.operation。

v2 reader 验证 mapping 与真实请求一致、响应包含全部必要结果，并从最后一次成功响应重算规范化 output。
分数、类别、rationale 或逐项映射不一致均为 invalid；失败或中断调用不能伪造 completed。
Definition digest 继续表示 Match 算法定义；Provider identity 的协议 revision 独立约束传输与映射解释。
任何版本的审计都保存实际 HTTP 请求正文，不用伪造的 Chat Completions envelope 替换 TypeSafe 事实。

## 验收边界

安装后公开入口证明自定义与内建 Match 都能通过 check 使用，judge 糖不会增加 entry 或调用。
确定性 Provider 边界验证分类映射、完整分母、catch 后失败锁存、预算拒绝零发送和取消后禁止后续发送。
公开 Assertion detail 验证新审计及历史材料读回；畸形与未知版本必须保持不同结果。
模型判断质量属于真实模型校准，协议 fixture 的通过不能代替它。

Provider 验收包含四个工厂的公开导入、凭据声明位置、模型替换与整体替换、TypeSafe 非等距 anchor 分数和能力拒绝。
同一结果经公开 Assertion detail 读回 v1/v2；动态 anchors、批量 ID、畸形概率与超限响应具有独立的可观察失败。
迁移错误在相关业务动作之前交付位置与英文指南；历史结果读取与旧源码配置拒绝分别验收。
