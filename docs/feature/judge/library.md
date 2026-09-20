# Judge —— Library

Judge 是使用受管模型能力的 `ScoreMatch`。`defineJudge` 与五个现成裁判都调用公开 `defineScoreMatch`。
`t.check(value, match)` 统一登记评价；`t.judge(value, match)` 是转交同一个 `check` 接收者的便利入口。
root、Session 与 Turn 都要求显式材料。

## 定义与调用

```ts
const answerQuality = defineJudge({
  name: "answer-quality",
  rubric: "根据 question 评价 answer 是否准确、完整地回答问题。",
  anchors: [
    { measurement: 0, description: "没有回答问题" },
    { measurement: 0.5, description: "回答主要问题，但遗漏必要解释" },
    { measurement: 1, description: "完整准确地回答问题" },
  ],
});

export default app.defineScoreEval({
  judge: { model: "judge-model" },
  async test(t) {
    const answer = await t.answer(question);
    t.check({ question, answer }, answerQuality).gate(0.7).score(10);
  },
});
```

Match 只定义怎样得到测量值；minimum、points、label 和 stop 都属于登记后的 Assertion handle。
同一 entry 上的 gate 与 score 可任意先后组合，评价仍只执行一次。
模型失败和不完整评价不能伪装成零分或完整成绩。

官方 root、custom Adapter 的 `t`、Session 与 Turn 都提供 `factuality(material, options?)`、
`faithfulness(material, options?)`、`instructionFollowing(material, options?)`、
`pairwisePreference(material, options?)` 与 `closeQA(material, options?)`。这些方法只构造对应 Match，
再交给当前接收者的同一个 `check`；`defineJudge`、`defineScoreMatch`、现成 factory 与 `t.judge` 也继续可用。

```ts
const answer = await t.send("只根据材料回答。");
answer.closeQA({
  input: "只根据材料回答。",
  output: answer.message,
  context: "材料说明发布日是周五。",
}).gate(0.8);

// 等价于当前接收者的同一条 check 路径：
t.check(
  { input: "只根据材料回答。", output: answer.message, context: "材料说明发布日是周五。" },
  closeQA(),
).gate(0.8);
```

## 自由评分定义

```ts
interface JudgeAnchor {
  readonly measurement: number;
  readonly description: string;
}
interface JudgeOptions {
  readonly name: string;
  readonly rubric: string;
  readonly anchors?: readonly JudgeAnchor[];
  readonly maxCalls?: number;
  readonly maxMaterialBytes?: number;
  readonly maxAuditBytes?: number;
}
type JudgeDefinition = ScoreMatch<unknown>;
declare function defineJudge(options: JudgeOptions): JudgeDefinition;
```

name 非空，最多 128 UTF-8 bytes，不含控制字符。rubric 非空，最多 8 KiB。
anchors 默认提供 0 与 1 的描述；显式 anchors 有 2 至 32 项，measurement 严格递增并包含 0 与 1。
每项 description 非空，最多 1 KiB。模型可以输出 anchors 之间的连续值；它不是置信度。
选项在定义时有界校验并冻结，未知字段和 accessor 拒绝。

预算默认值与总账规则由 [Architecture](architecture.md#预算与生命周期) 拥有。
定义中的 rubric、anchors、算法版本与预算参与身份，handle 的质量门和分值不改变 Judge 请求。

## 现成裁判

```ts
interface JudgePresetOptions {
  readonly name?: string;
  readonly maxCalls?: number;
  readonly maxMaterialBytes?: number;
  readonly maxAuditBytes?: number;
}
interface FactualityMaterial {
  readonly input: string;
  readonly output: string;
  readonly expected: string;
}
interface FaithfulnessMaterial {
  readonly input: string;
  readonly output: string;
  readonly context: string | readonly string[];
}
interface InstructionFollowingMaterial {
  readonly instructions: readonly string[];
  readonly output: string;
}
interface PairwisePreferenceMaterial {
  readonly instructions: string;
  readonly output: string;
  readonly reference: string;
}
interface CloseQAMaterial {
  readonly input: string;
  readonly output: string;
  readonly context: string | readonly string[];
}
declare function factuality(options?: JudgePresetOptions): ScoreMatch<FactualityMaterial>;
declare function faithfulness(options?: JudgePresetOptions): ScoreMatch<FaithfulnessMaterial>;
declare function instructionFollowing(options?: JudgePresetOptions): ScoreMatch<InstructionFollowingMaterial>;
declare function pairwisePreference(options?: JudgePresetOptions): ScoreMatch<PairwisePreferenceMaterial>;
declare function closeQA(options?: JudgePresetOptions): ScoreMatch<CloseQAMaterial>;
```

五个工厂及其材料类型从 `niceeval` 和 `niceeval/expect` 导出。
每个工厂返回可复用的定义实例；默认 name 分别为 factuality、faithfulness、instruction-following、pairwise-preference 和 close-qa。
必填文本非空；instructions 是 1 至 32 项非空文本，context 数组非空。非法材料不会进入模型调用。

| 裁判 | 计算方法 | 分数含义 |
|---|---|---|
| factuality | 分类后映射：consistent=1、incomplete=0.5、contradictory=0 | 相对给定参考的内容一致性与完整度 |
| faithfulness | 提取陈述，再全量分类，由代码计算 supported / total | 已提取陈述受到上下文支持的比例 |
| instructionFollowing | 对作者列出的每项要求分类，代码计算 followed / total | 明确要求的满足比例 |
| pairwisePreference | candidate=1、tie=0.5、reference=0 | 本次比较中对候选答案的偏好 |
| closeQA | correct=1、incomplete=0.5、incorrect=0 | 只依据给定材料回答的完整性与正确性 |

Factuality 的 expected 是作者提供的参考，不是经过外部验证的事实依据。
Faithfulness 不是让模型整体估计比例；完整分母与逐项结果必须可读。提取为空或不完整时是 unavailable。
比较裁判允许平局，分数不是胜率；一次比较不保证消除位置偏差。
`closeQA()` 只使用 `input`、`output` 与 `context`。完整有据的回答，或材料不足时准确拒答，为 correct；
有据但遗漏必要内容为 incomplete；编造、矛盾、答非所问，或材料足以回答却拒答为 incorrect。分类冲突时，
依次以 incorrect、incomplete、correct 为准。
完整场景见 [使用现成裁判并复核判分依据](use-case/inspect-judge-score.md)。

## 自定义 Match 与声明

高级 `defineScoreMatch` 的公开上下文提供 score、classify、extract 和 batchClassify 原语。
自定义代码可以用 Effect 组合相同能力，受同一个 Attempt 的预算、取消和封口管理。
高级 callback 与结果类型见 [自定义 Match](../assertions/library/custom-assertions.md)；原语的严格输出约束见 [原语与算法](architecture.md#原语与算法)。

Eval 的 `judge` 字段为这道题指定 Judge 模型配置，不声明或授权 Match。指定字段替换项目默认值，Experiment 还能进一步替换。所有受管 Match 都经现有
Assertion runtime 取得同一条预算、快照、求值、审计、封口与 handle 路径；普通纯 Match 不取得模型上下文。

## 材料与读回

check 同步验证入口和 Match，然后生成有界 canonical JSON 快照。
材料接受字符串、有限数字、布尔值、null、数组和普通对象；拒绝函数、BigInt、Symbol、class、getter、toJSON、循环、数组空洞和 undefined 元素。
对象内 undefined 属性省略；对象键排序，数组保序，负零规范为零。共享子对象可重复出现。
最大深度 32，最多遍历 16,384 个节点；Proxy 反射不构成沙箱边界。

高级 callback 只看到冻结快照。每次原语调用另行冻结规则和显式材料，并通过同一受管 Provider 执行。
原语失败会锁存 entry 的失败状态，callback 捕获错误后返回数值也不能掩盖失败。
模型输出只作为结果数据，不执行其中的指令或代码。

初始材料及完整步骤审计进入受管 Content，可从公开 Assertion detail 读取。
审计保存实际请求、尝试、结构化输出和最终聚合；schema、预算、取消及历史读取由 [Architecture](architecture.md) 定义。
历史材料不会被重新解释或迁移。审计能证明经框架进行的调用，不能证明作者隐藏闭包、模型判断或外部事实正确。

## Runtime 配置

Experiment、Eval 与项目配置的 Judge 字段只声明 Provider Profile，不定义评价标准。Eval 的 `judge` 为这道题指定模型配置；指定字段替换项目默认值，Experiment 的 `judgeRuntime` 还能进一步替换：

```ts
interface JudgeConfig {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
}
```

| 字段 | 含义与限制 | 未指定时 |
| --- | --- | --- |
| `model` | 非空、无控制字符的模型名 | 继续从较低优先级层取得；四层都没有时 Assertion 为 unavailable 且零网络 |
| `baseUrl` | 绝对 `http(s)` URL | `https://api.openai.com/v1` |
| `apiKeyEnv` | 进程变量名，不保存变量值 | `NICEEVAL_JUDGE_KEY` |
| `timeoutMs` | 正安全整数，限定整条 Judge Assertion 的请求、重试与等待 | `180_000` |
| `maxOutputTokens` | 正安全整数，限定请求允许生成的最大 token 数 | `1_024` |

配置在定义时校验并冻结；拒绝未知字段与 accessor。文本字段最多 8 KiB UTF-8 bytes，不能含控制字符；
`apiKeyEnv` 必须是合法进程变量名。字段省略或为 `undefined` 时逐字段继承，不删除较低优先级层的值。

```ts
export default defineConfig({
  judgeRuntime: {
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
    timeoutMs: 120_000,
    maxOutputTokens: 2_048,
  },
});
```

模型、端点、credential selector、超时、输出上限和协议参与 Runtime identity，不保存凭据值。
模型或 key 缺失时不发请求，评价 unavailable。系统不做独立网络预检；实际调用是受管原语的
forced-function 请求，并严格校验响应。HTTP 400 或协议不兼容为 errored；传输失败或超时为 unavailable，
取消保持 Effect interruption。
响应在 JSON parse 前受硬字节上限约束；审计和输出预算不足时必须拒绝，不能静默裁剪后计分。
