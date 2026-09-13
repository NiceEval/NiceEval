# Judge —— 架构

## 一个 Match 执行协议

`defineJudge` 和现成裁判调用公开 `defineScoreMatch`，返回真实 `ScoreMatch`。
`t.check` 统一准备、登记、执行和封口；`t.judge` 校验受管 LLM Match 后转交同一入口。
Context 不按 Judge 名称或预设名称选择另一条登记路径。
普通数值和 Promise callback 在边界适配为 Effect；高级 callback 直接组合 Effect 与受管 LLM 原语。

Match 不拥有 gate、points、stop、源码位置或 Assertion identity。
这些事实仍由同一个 Assertion runtime 保存，每次 `check` 只产生一个 entry。

## 授权、身份与输入

入口开放检查与 Eval 的精确 Match 实例授权先于材料反射。
高级 Match 接收登记时生成的深冻结 canonical JSON 快照，后续调用方修改原对象不会改变输入。
受管 LLM 的允许列表只授权框架提供的模型调用能力，不是 JavaScript 沙箱。
作者 callback 属于可信项目代码。

高级 Match 显式声明非空 `version` 和 canonical JSON `config`，与名称、预算和协议一起进入定义摘要。
框架同时沿用 Eval 的源码身份；不以 `Function.toString()` 推断隐藏闭包或外部状态。
作者必须把影响评分的参数写入 config，并在算法改变时更新 version。
自定义 criterion 只声明名称和测量尺度，不声称证明 callback 的实际语义。
内置算法的版本、分类映射和配置共同定义它的解释。

## 预算与生命周期

每个 entry 有独占执行上下文、串行调用序号、失败锁存器和审计容量。
`maxCalls` 计逻辑原语调用，默认 4，上限 16；每个调用最多 3 次传输尝试。
Judge Runtime 的 timeout 限定该 entry 的整个高级 callback、全部步骤、重试和等待，不能每步重新获得完整期限。

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

以下为审计的完整逻辑形状。JSON 文本使用 canonical 编码；传输表示按 UTF-8 安全分块并保存摘要和字节数。
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
新审计采用独立协议和 criterion，不改写既有 Record，不增加另一种持久 family。
旧 reader 遇到未知 criterion 只把对应 entry 标为 unsupported；其余既有事实继续可读。

## 原语与算法

框架提供 score、classify、extract 和 batchClassify 四个窄原语。
它们共享 Provider、重试、取消、预算与留存，不执行模型生成的工具或代码。
输入材料只进入不可信 user 内容，评价规则进入 system 内容。
模型输出使用封闭 schema 严格解码；原语之外的映射和聚合由代码执行。
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

## 验收边界

安装后公开入口证明自定义与内建 Match 都能通过 check 使用，judge 糖不会增加 entry 或调用。
确定性 Provider 边界验证分类映射、完整分母、catch 后失败锁存、预算拒绝零发送和取消后禁止后续发送。
公开 Assertion detail 验证新审计及历史材料读回；畸形与未知版本必须保持不同结果。
模型判断质量属于真实模型校准，协议 fixture 的通过不能代替它。
