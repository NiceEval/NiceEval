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
  judge: "judge-model",
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

Eval 的 `judge` 字段为这道题选择模型或完整裁判 Provider，不声明或授权 Match。配置优先级见 [Runtime 配置](#runtime-配置)。所有受管 Match 都经现有
Assertion runtime 取得同一条预算、快照、求值、审计、封口与 handle 路径；普通纯 Match 不取得模型上下文。

## 材料与读回

check 同步验证入口和 Match，然后生成有界 canonical JSON 快照。
除下述显式图片值外，材料接受字符串、有限数字、布尔值、null、数组和普通对象；拒绝函数、BigInt、Symbol、class、getter、toJSON、循环、数组空洞和 undefined 元素。
对象内 undefined 属性省略；对象键排序，数组保序，负零规范为零。共享子对象可重复出现。
最大深度 32，最多遍历 16,384 个节点；Proxy 反射不构成沙箱边界。

高级 callback 只看到冻结快照。每次原语调用另行冻结规则和显式材料，并通过同一受管 Provider 执行。
原语失败会锁存 entry 的失败状态，callback 捕获错误后返回数值也不能掩盖失败。
模型输出只作为结果数据，不执行其中的指令或代码。

初始材料及完整步骤审计进入受管 Content，可从公开 Assertion detail 读取。
审计保存实际请求、尝试、结构化输出和最终聚合；schema、预算、取消及历史读取由 [Architecture](architecture.md) 定义。
历史材料不会被重新解释或迁移。审计能证明经框架进行的调用，不能证明作者隐藏闭包、模型判断或外部事实正确。

## Runtime 配置

裁判 Provider 是由具名工厂构造的不透明值，拥有服务端协议、默认模型、端点、凭据声明位置与执行限制。
项目配置必须显式选择 Provider；Eval 与 Experiment 可以只换模型，也可以整体替换 Provider。
`defineJudge`、现成裁判、`t.judge`、`t.check` 和 handle 的用法不随 Provider 改变。

### 工厂与类型

四个工厂及下列类型从 `niceeval/judge` 导出。工厂是普通函数，不使用 `new`；返回值冻结且带运行时构造凭据，
不能以普通对象、展开复制或反序列化 JSON 代替。定义时不请求网络，也不读取凭据。

```ts
declare const judgeProviderBrand: unique symbol;
interface JudgeProvider {
  readonly [judgeProviderBrand]: true;
}
type JudgeSelection = string | JudgeProvider;
type JudgeCredentials =
  | { readonly apiKey?: never; readonly apiKeyEnv?: string }
  | { readonly apiKey: string; readonly apiKeyEnv?: never };
interface JudgeProviderSettings {
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}
type ChatJudgeProviderOptions = JudgeProviderSettings & JudgeCredentials & {
  readonly maxOutputTokens?: number;
  readonly supportsImages?: boolean;
};
type TypesafeProviderOptions = JudgeProviderSettings & JudgeCredentials;
declare function OpenAIProvider(options: ChatJudgeProviderOptions): JudgeProvider;
declare function VercelProvider(options: ChatJudgeProviderOptions): JudgeProvider;
declare function OpenRouterProvider(options: ChatJudgeProviderOptions): JudgeProvider;
declare function TypesafeProvider(options: TypesafeProviderOptions): JudgeProvider;

interface ProjectJudgeSettings {
  readonly judgeRuntime?: JudgeProvider;
}
interface EvalJudgeSettings {
  readonly judge?: JudgeSelection;
}
interface ExperimentJudgeSettings {
  readonly judgeRuntime?: JudgeSelection;
}
```

品牌 symbol 不导出。Provider 只暴露品牌类型，不公开 SDK client、可修改字段或凭据值；以上三个 Settings
分别描述所在定义的 Judge 字段，不是另一个配置包装对象。`JudgeSelection` 的字符串是原样交给选定服务的模型 ID。

| 工厂 | 服务 | 默认 `baseUrl` | 默认凭据变量 |
| --- | --- | --- | --- |
| `OpenAIProvider` | OpenAI 或显式兼容网关 | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `VercelProvider` | Vercel AI Gateway | `https://ai-gateway.vercel.sh/v1` | `AI_GATEWAY_API_KEY` |
| `OpenRouterProvider` | OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `TypesafeProvider` | TypeSafe System One | `https://api.typesafe.ai/v1` | `TYPESAFE_API_KEY` |

`VercelProvider` 只表示 AI Gateway，与 Vercel Sandbox 和通用 Vercel AI SDK 模型对象无关。
三个聊天服务工厂使用受管 forced-function 请求；TypeSafe 使用 `/systemone`，不伪装成 Chat Completions。

| 选项 | 契约 | 默认 |
| --- | --- | --- |
| `model` | 必填、非空、无控制字符，最多 8 KiB；模型是否可用由实际调用验证 | 无 |
| `baseUrl` | 绝对 `http(s)` URL，不含 userinfo、query 或 fragment；显式替换只影响本 Provider | 上表 |
| `apiKeyEnv` | 合法进程变量名；与 `apiKey` 互斥 | 上表 |
| `apiKey` | 非空秘密字符串；仅在私有闭包保存，作者不得把字面秘密签入源码 | 从选定变量读取 |
| `timeoutMs` | 正安全整数，约束整条 Assertion 的 callback、请求、重试与等待 | `180_000` |
| `maxResponseBytes` | 正安全整数，最多 256 KiB；JSON parse 前的响应硬字节上限 | `16_384` |
| `maxOutputTokens` | 仅聊天服务工厂接受的正安全整数，传给服务端的输出 token 上限 | `1_024` |

未知字段、accessor 和非法选项在构造时拒绝。TypeSafe 不接受 `maxOutputTokens`，因为它的协议没有这一限制；
响应字节限制不等价于服务端生成量或费用限制。实际响应上限还受当前 Assertion 剩余审计容量约束。

### 模型与 Provider 替换

配置求值从 `Config.judgeRuntime` 开始，依次应用 `Eval.judge` 和 `Experiment.judgeRuntime`。
最高优先级的 Provider 是整份配置的起点；只应用它之后更高层的模型字符串。`undefined` 不改变选择。

| 替换值 | 结果 |
| --- | --- |
| 模型字符串 | 仅替换已选 Provider 的模型；端点、凭据声明位置和执行限制保持该 Provider 的值 |
| Provider | 整体替换服务、默认模型、端点、凭据声明位置和全部执行限制；省略选项使用新工厂自己的默认 |
| 所有层都没有 Provider | 实际 Judge 为 `unavailable`，具名原因 `judge-provider-unresolved`，零网络 |

较低层只有模型字符串时，较高层的完整 Provider 仍可生效，较低层字符串不替换它的默认模型。
普通不使用模型的 Match 不要求配置 Provider。没有按 hostname、模型前缀或已有进程 key 猜服务的规则。

```ts
import { defineConfig } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: OpenAIProvider({ model: "judge-model", timeoutMs: 120_000 }),
});
```

Eval 的 `judge: "another-model"` 保留该 Provider 的 120 秒期限。Eval 的
`judge: TypesafeProvider({ model: "jev-1.13.0" })` 则使用 TypeSafe 的端点、凭据和默认期限。
Experiment 的完整 Provider 可以再次整体替换这份选择；完整场景见 [裁判 A/B](use-case/experiment-ab.md)。

### 凭据与失败

CLI 沿项目现有 `.env` 加载入口投递尚未设置的进程变量，再加载项目模块；已经存在的进程变量优先。
Library 不隐式寻找 `.env`，宿主负责把凭据放进子进程变量集合或工厂 `apiKey`。Provider 只在实际调用前读取自己的凭据声明位置。
默认凭据只读上表对应的一个变量，不回落到 `NICEEVAL_JUDGE_KEY`、其他服务变量或 Vercel OIDC token。

`apiKeyEnv` 显式指定时只读该变量；`apiKey` 显式指定时不再查进程变量。Provider 私有状态中的凭据值及其摘要
不进入 identity、Record、审计、日志、对象展示或迁移指南。身份只保存 `inline` 或变量名这样的凭据选择。

没有 key 时 Judge 为 `unavailable`，原因 `judge-key-unresolved`，不发请求。系统不做独立网络预检。
HTTP 400、协议不兼容与非法响应为 `errored`；传输失败或超时为 `unavailable`；取消保持 Effect interruption。
SDK 不得另行读取默认模型、endpoint、key、设置重试或把请求正文写入日志。

### TypeSafe 的测量能力

`score` 将 rubric 作为 instructions、2 至 10 个 anchor 描述作为有序 levels。返回的测量值为
`Σ(probabilities[i] × anchors[i].measurement)`，保留非等距 anchors；不使用 confidence，也不直接归一化等级索引。
`classify` 使用 Choice 返回的类别，现成裁判仍按既有类别映射计分。`batchClassify` 在同一请求内为各项创建独立问题。

超过 10 个 anchors 或调用 `extract` 时，零网络返回 `judge-capability-unavailable` 并锁存失败。
因此 `faithfulness()` 在 TypeSafe 上为 `unavailable`；它不会改为整体估分、截断 anchors、调用辅助模型或改变评分分母。

TypeSafe 的 `rationale` 是明确以 `TypeSafe result summary (generated by NiceEval):` 开头的程序摘要，说明
返回类别或概率加权过程；它不是模型生成的推理解释。完整分布、confidence、原始响应和映射材料保留在审计中。
判分算法、Provider revision 和模型均进入身份；不同 Provider 的质量必须另以实际样本校准。

## 旧配置的迁移诊断

普通 `{ model, baseUrl, apiKeyEnv, timeoutMs, maxOutputTokens }` 配置对象不是 Provider。
配置边界识别该旧形状时拒绝相关功能，并按 [DX 迁移](../error-assistance/README.md#dx-迁移) 输出源码位置与
`judge-provider` 英文指南。迁移只替换 Provider 与模型配置，不改 rubric、材料、`.gate()` 或 `.score()`。

## 原生图片材料

图片仅作为作者选定 Judge 的可选材料，不自动登记断言或增加画面质量门槛。
从 `niceeval/judge` 导入不透明图片工厂：

```ts
declare const judgeImageBrand: unique symbol;
interface JudgeImage { readonly [judgeImageBrand]: true }
interface JudgeImageInput {
  readonly body: Uint8Array;
  readonly mediaType: "image/png" | "image/jpeg";
}
type JudgeMaterial =
  | null | boolean | number | string | JudgeImage
  | readonly JudgeMaterial[]
  | { readonly [key: string]: JudgeMaterial };
declare function judgeImage(input: JudgeImageInput): JudgeImage;
```

`judgeImage` 同步复制 bytes；之后修改原数组不会改变图像。图片值可嵌入对象或数组，
也可交给高级 Match 的四种 LLM 原语。它不是路径、远端 URL 或 base64 文本；普通 JSON
不能伪造图片能力。已有 `ctx.attach` 可继续保存原附件，Judge 独立封存同一原始 bytes，
不依赖附件 receipt、原目录或外部服务。

```ts
import { defineJudge } from "niceeval";
import { judgeImage, VercelProvider } from "niceeval/judge";

const quality = defineJudge({
  name: "action-quality/v1",
  rubric: "Evaluate the described behavior; use the screenshot as supplementary evidence.",
});
const provider = VercelProvider({
  model: "your-vision-and-tool-capable-model",
  supportsImages: true,
});
// Set provider as judgeRuntime in the project or Experiment.
// Inside the Eval, pngBytes are already captured application bytes:
t.judge({
  behavior,
  screenshot: judgeImage({ body: pngBytes, mediaType: "image/png" }),
}, quality).score(1);
```

PNG、JPEG 每张最多 4 MiB，像素数最多 16,777,216；每个 Assertion 最多 4 张、合计 8 MiB。
检查签名、header 边界、正尺寸和 MIME 一致性，不声称完成全部像素解码；不隐式转码或缩放。
每次原语的实际图片 parts 也受相同数量与字节上限约束，重复引用不能绕过。
同一 Attempt 图片留存上限 32 MiB，跨 Assertion 重用仍分别计入；文本预算保持不变。

`OpenAIProvider`、`VercelProvider`、`OpenRouterProvider` 在显式
`supportsImages: true` 时将图片发送为 Chat Completions 的 `image_url` data URI parts。
默认不启用；作者负责最终模型同时支持视觉和强制工具输出。模型字符串替换继承声明，
完整 Provider 替换采用新声明。声明进入配置身份和复用指纹，不代表在线探测结果。
`TypesafeProvider` 与未启用图片的聊天 Provider 在读取凭据、构造 wire body 或发送前
返回 `judge-capability-unavailable`；不能静默丢图或改成文本评分。

含图片的 Assertion 使用 v3 审计，纯 JSON 保持已有 v1/v2。公开
`attempt.assertion.detail` 返回图片摘要与请求模板，不内嵌大图。
`attempt.assertion.image` 通过 `locator + entryId + imageId` 选择本 Assertion
的封存图片，接受字节 `offset/limit`，返回原图 metadata、区间 base64 与 `nextOffset`。
Record 搬迁后相同身份仍可读，不重新调用模型。
