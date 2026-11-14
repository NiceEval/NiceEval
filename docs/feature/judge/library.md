# Judge —— Library

Judge 是使用受管模型能力的 `ScoreMatch`。`defineJudge` 与四个现成裁判都调用公开 `defineScoreMatch`。
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

官方 root、custom Adapter 的 `t`、Session 与 Turn 提供四个显式材料预设：
`factuality`、`faithfulness`、`instructionFollowing`、`pairwisePreference`。
它们构造对应 Match 后交给同一 `check` 接收者。通用材料验收使用 `closeQA(selector, question, options?)`。
Agent 应用提供 `closeQA(question, options?)`，使用接收者当前 scope 的完整正式历史，不只取最后一句回答。
显式 EventMatch 或 ToolMatch 则使用对应领域的全部命中材料；游戏等应用使用自身 MaterialMatch。

```ts
import { eventMatch } from "niceeval/expect";
const answer = await t.send("列出风险与回滚步骤。");
answer.closeQA("这轮是否说明风险和可执行的回滚步骤？").gate(0.8);
answer.closeQA(
  eventMatch("message", { role: "assistant" }),
  "全部发言是否清楚说明风险？",
).gate(0.8);
```

MaterialMatch 的 reader 从当前 ctx 取出业务事实，单项 predicate 在同一候选上判断。NiceEval 对全部候选求值，并将全部命中项保序交给一次受管 Judge。
问题是材料验收条件，不是预设答案；不会逐项评分或只挑成功样本。
所有 closeQA 写法组合一个受管评分 Match 后交同一 check，返回同一种 measurement handle。
完整空集为0且零模型调用；partial、unknown、超限或模型不可判定为 unavailable。

Agent 默认历史与 EventMatch/ToolMatch 简写采用 16384 项、4 MiB、1048576 节点、深度 64 的捕获上限。
显式 MaterialMatch 使用自己的 capture 配置；Judge 命中材料与审计预算仍由 options 独立指定。
ctx 材料读取与存在性使用见 [材料选择](../assertions/library/custom-assertions.md#材料选择)。

## Judge 用量与费用

closeQA、defineJudge 与受管 ScoreMatch 自动登记每次实际 HTTP 传输，失败、重试和中断均保留。
未通过发送前校验的逻辑步骤不算物理请求；取消表示本地停止等待，不证明服务端停工。
现有 `defineConfig.pricing` 可对请求模型提供显式估价；真实报告费用（含零）优先，不在读取时重新定价。
`t.usage` 仍只表示被测应用用量，Adapter 无需替裁判上报用量。

Query、Show 与 View 从同一已封存账本读取 Judge 数量、tokens、费用和完整度，应用费用与总费用分别呈现。
缺账本不是零调用；费用缺项不是零费用。完整空账本证明没有发送，但不制造 USD 0 回执。
完整结果与已知小计、币种及缺口的形状见 [Inspection 费用读面](../inspection/cli.md#judge-用量与总费用)。

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

## 二值裁判

只问“满足还是不满足”的判据用 `binaryJudge`，不必每个项目自己封装两个 anchor：

```ts
import { binaryJudge } from "niceeval/expect";

t.judge({ reply: turn.reply, verified }, binaryJudge({
  name: "handoff-names-violation",
  rubric: "Y 当且仅当回复指出了被读取的禁区路径，并且报告的结果与 verified 一致。",
})).score(2);
```

```ts
type BinaryJudgeOptions = Omit<JudgeOptions, "anchors">;
declare function binaryJudge(options: BinaryJudgeOptions): JudgeDefinition;
```

`binaryJudge` 从 `niceeval/expect` 导出，选项校验、材料与审计预算和 `defineJudge` 相同，但不接受 `anchors`。
它通过一次受管 `classify` 请求在 `satisfied` 与 `not-satisfied` 中选择，由代码分别映射成 `1` 与 `0`。它不调用允许连续值的 `score`，不阈值化概率或置信度。
合法 measurement 只有 `0` 或 `1`；无效输出、预算或 Provider 失败沿用 Judge 的错误与 unavailable 规则，不映射为 `0`。
返回值使用普通 measurement handle，以 `.gate(1)` 建立质量门，`.score(points)` 得到 `0` 或满分。recipe identity 包含二值分类算法与 revision，审计保留类别、理由和映射结果。

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
declare function factuality(options?: JudgePresetOptions): ScoreMatch<FactualityMaterial>;
declare function faithfulness(options?: JudgePresetOptions): ScoreMatch<FaithfulnessMaterial>;
declare function instructionFollowing(options?: JudgePresetOptions): ScoreMatch<InstructionFollowingMaterial>;
declare function pairwisePreference(options?: JudgePresetOptions): ScoreMatch<PairwisePreferenceMaterial>;
```

四个工厂及其材料类型从 `niceeval` 和 `niceeval/expect` 导出。
每个工厂返回可复用的定义实例；默认 name 分别为 factuality、faithfulness、instruction-following和 pairwise-preference。
必填文本非空；instructions 是 1 至 32 项非空文本，context 数组非空。非法材料不会进入模型调用。

| 裁判 | 计算方法 | 分数含义 |
|---|---|---|
| factuality | 分类后映射：consistent=1、incomplete=0.5、contradictory=0 | 相对给定参考的内容一致性与完整度 |
| faithfulness | 提取陈述，再全量分类，由代码计算 supported / total | 已提取陈述受到上下文支持的比例 |
| instructionFollowing | 对作者列出的每项要求分类，代码计算 followed / total | 明确要求的满足比例 |
| pairwisePreference | candidate=1、tie=0.5、reference=0 | 本次比较中对候选答案的偏好 |

Factuality 的 expected 是作者提供的参考，不是经过外部验证的事实依据。
Faithfulness 不是让模型整体估计比例；完整分母与逐项结果必须可读。提取为空或不完整时是 unavailable。
比较裁判允许平局，分数不是胜率；一次比较不保证消除位置偏差。
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

## Agent Judge —— 在 Sandbox 里自己取证再评分

`defineJudge` 只看调用方交给它的材料。安装、重构、修复这类开放式判据，要看的东西散在被测 Sandbox 里：作者改了哪些文件、项目怎么组织、命令能不能跑。
调用方只好先写取证脚本，收集源码、读布局、压缩到材料上限，再交给 Judge，判据的一半其实写在脚本里（[T-25](../../taste.md#t-25)、[T-33](../../taste.md#t-33)）。

Agent Judge 是一个带工具的评审 agent。它在这条 Attempt 的主 Sandbox 里自己查看文件、运行命令，最后调用评分工具交出 measurement、理由与证据。
它仍是受管 `ScoreMatch`：经 `t.check` / `t.judge` 登记，measurement 落在 `[0,1]`，`.gate()`、`.score()` 与其它 Judge 完全相同。

能直接读到的事实（verdict、退出码、文件是否改动、工具调用次数）继续用确定性检查。Agent Judge 只用于需要探索和判断的开放式判据；它有随机性，换模型分数会漂移。

### 定义与调用

`defineAgentJudge` 定义一个评审者；题目里用 `t.agentJudge(reviewer, material)` 开一次评审会话，然后像对话一样逐道提问。
每次 `review.judge(prompt)` 问一道评分题，返回普通的 measurement handle，`.gate()`、`.score()`、`.key()`、`.label()` 照常使用。
`review.chat(message)` 发一条不计分的消息，例如先让评审列出被测 agent 新增的文件。评审在同一个会话里依次回答，后面的问题能直接用前面看过的现场，不必重读。
评分 prompt 直接写在调用处，读题的人在一处就能看到每一项问什么、给几分（[T-26](../../taste.md#t-26)）。

```ts
import { defineAgentJudge } from "niceeval/expect";

const reviewer = defineAgentJudge({
  name: "install.reviewer",
  instructions: "你在评审被测 agent 刚在这个仓库里完成的 NiceEval 接入。自己阅读文件、运行命令取证。",
});

export default defineScoreEval({
  sandbox: /* … */,
  async test(t) {
    const turn = await t.send("把 niceeval 接入这个仓库。");
    const review = t.agentJudge(reviewer, { handoff: turn.reply });
    review.chat("先找到 niceeval.config.ts，列出 agent 写的 Adapter、Experiment 与 Eval 文件。");
    review.judge("Y 当且仅当 NiceEval 装进了适用的现有根工具项目，保留原有包管理器与锁文件归属。")
      .score(3).key("install.layout.owner").label("安装融入宿主工具链");
    review.judge("Y 当且仅当 Adapter 在非 2xx、解析错误或连接中断时抛出或映射为失败。")
      .score(2).key("install.adapter.error-propagation").label("错误不被吞掉");
  },
});
```

```ts
interface AgentJudgeDefinition {
  readonly name: string;
  readonly instructions?: string;             // 这位评审者看什么、从哪里开始，会话内所有问题共用
  readonly anchors?: readonly JudgeAnchor[];  // 评分题的默认 anchors；省略时为二值：0 不满足，1 满足
  readonly maxTurns?: number;                 // 每道评分题的逻辑模型轮次上限，默认 40
  readonly timeoutMs?: number;                // 整次会话的墙钟上限，默认 600_000
  readonly maxMaterialBytes?: number;
  readonly maxAuditBytes?: number;
}

interface AgentJudgeReview {
  judge(prompt: string, options?: { readonly anchors?: readonly JudgeAnchor[] }): MeasurementHandle;
  chat(message: string): void;
}

declare function defineAgentJudge(definition: AgentJudgeDefinition): AgentJudge;
// t.agentJudge(reviewer: AgentJudge, material: JudgeMaterial): AgentJudgeReview
```

- `defineAgentJudge` 与相关类型从 `niceeval/expect` 导出，`t.agentJudge` 在官方 root、custom Adapter 的 `t`、Session 与 Turn 上可用。name、prompt 与 anchors 沿用 `defineJudge` 的校验，prompt 与 message 为非空文本；执行上限必须为正安全整数；未知字段和 accessor 拒绝，定义校验后冻结。
- `t.agentJudge(reviewer, material)` 只登记会话，不立即执行；材料是会话的开场上下文，没有时传 `{}`。材料快照规则与 [Judge 材料](#材料与读回) 相同。冻结的是开场材料，Sandbox 是评审执行时的可变现场。
- 每个 `judge(prompt)` 是一个独立断言 entry；`chat(message)` 不产生 entry，只出现在会话轨迹里。同一会话的 judge 与 chat 按调用顺序进入会话。
- 会话只执行到最后一道评分题为止：最后一道题之后的 `chat` 不发送；没有任何评分题的会话不执行、不发模型请求，也不报错。
- 只能用在拥有主 Sandbox 的 Attempt：direct agent 或没有 Sandbox 的 Eval 在登记时报 `judge.agent-requires-sandbox`。
- 材料预算沿用 [预算与生命周期](architecture.md#预算与生命周期) 的默认值与总账；审计上限默认 4 MiB，足够一次几十轮的工具评审。容量不足会得到 unavailable，不能静默丢弃轨迹。
- 只能用在每条 Attempt 独占 Sandbox 的 Eval。评审有完整写权限，可能改动 State 路径或组内共享的现场，所以声明了 State、属于共享 Sandbox 的 Eval Group 或启用 `sandboxReuse` 的配对登记 Agent Judge 时，在规划阶段报 `judge.agent-shared-sandbox`。
- Agent Judge 不能挂 `.stop()`：它在被测运行结束后才执行，不能作为提前停止的屏障，挂上时登记报错。
- 模型使用 Eval × Experiment 生效的 Judge 配置，不增加 Match 级模型替换。身份与缓存规则见 [Agent Judge 架构](architecture.md#agent-judge)。

### 评审 agent

评审 agent 由 NiceEval 在宿主进程里用 `@earendil-works/pi-agent-core` 运行（可选依赖，未安装时登记报错并给出 `pnpm add` 下一步）。
模型取这条 Eval 生效的 Judge Provider 与模型。聊天 Provider 通过受管 Chat Completions 工具协议执行；接口兼容不保证所选模型支持工具。
`TypesafeProvider` 在发送前得到 `unavailable`，原因 `agent-judge-unsupported-provider`。不探测能力，也不回落到普通评分。

`maxTurns` 计每轮逻辑模型生成，重试不另占轮次，工具调用不算模型轮次。第 40 轮仍可提交；需要第 41 轮才超限。
有效期限取定义的 `timeoutMs` 与 Attempt 剩余期限的较小值，包含模型、工具和等待；它取代 Provider 对整条 Assertion 的时限，单次模型请求仍受 Provider 的请求时限约束。

系统提示写明 rubric、anchors、评分工具的用法，以及“只根据你在 Sandbox 里亲眼看到的证据评分”。材料作为不可信 user 内容进入首条消息。

工具都作用在这条 Attempt 的主 Sandbox，以 Sandbox 默认用户、默认 workdir 执行：

| 工具 | 作用 |
|---|---|
| `bash` | `command` 交给 `sandbox.runShell`，返回退出码、stdout、stderr；单次默认 120 秒超时，输出各保留末尾 64 KiB |
| `read` | 读一个文件，可带行范围；超过 256 KiB 截断并注明 |
| `write` | 写入整个文件 |
| `edit` | 对一个文件做精确字符串替换 |
| `submit_evaluation` | 交出评分并结束评审 |

工具不限制只读。评审在 `workspace.diff` 冻结之后执行，它的写入不计入被测 agent 的改动，也不改变已冻结的 diff 证据。
输出限制按 UTF-8 bytes 计算并保留字符边界；工具返回值注明保留范围与是否截断。`read` 可用行范围继续取证。
工具截断是明确的观察范围，不代表完整文件或完整命令输出；模型响应与审计超限则终止评审，不裁剪成合法提交。

```ts
interface SubmitEvaluationInput {
  readonly measurement: number;               // [0,1] 内的有限数
  readonly rationale: string;                 // 对照 rubric 与 anchors 的理由
  readonly evidence: readonly {               // 支撑理由的证据，至少一条
    readonly kind: "file" | "command" | "observation";
    readonly ref: string;                     // 文件路径、执行过的命令或观察对象
    readonly note: string;
  }[];
}
```

- 会话按调用顺序处理：`chat` 作为一条 user 消息发出，评审回答后进入下一项；`judge` 作为一条评分题发出，评审取证后调用 `submit_evaluation` 结束这道题，再进入下一项。
- 提交严格拒绝未知字段，rationale、ref 与 note 为非空文本，整个提交受响应和审计字节上限约束。非法参数作为工具错误留存，模型可在这道题剩余的轮次内修正。
- 一道题超过 `maxTurns` 仍未提交，这道题为 `unavailable`，会话继续下一项；会话期限耗尽或传输最终失败时，当前与之后的评分题都为 `unavailable`，已提交的题保留各自的 measurement。
- 审计容量不足，或模型不调用评分工具就停止回答，当前评分题为 `unavailable`，不按零分处理。HTTP 400、畸形模型协议和框架 defect 沿用 `errored`；取消保持 interruption，不能伪装成 unavailable。
- 同一响应中的工具按返回顺序串行执行。一道题合法提交之后不执行同批剩余工具；失败锁存与取消不能被迟到提交清除。
- 工具本身的失败（命令非零退出、文件不存在）作为工具结果返回给评审，不终止评审；Sandbox 传输失败让断言 `unavailable`。

### 执行顺序

`assertions.evaluate` 先求值其它全部断言，再按会话的登记顺序逐个执行评审会话，同一 Attempt 内不并发。
普通断言即使登记在 Agent Judge 之后，也必须先完成；已由控制屏障求值的 entry 不重复执行。普通断言的 `.stop()` 屏障跳过 Agent Judge，不会让它提前执行。
后面的评审能看到前面评审写入的内容。rubric 的不写文件要求只是模型指令，不提供隔离保证。

评审命令与模型调用归属于该 Judge entry，不能进入被测 agent 的 history、工具计数、usage 或归因断言。
评审发生在 telemetry 收口前，trace 必须能区分评审与被测应用；时间先后不能代替归属。

### 审计、用量与读回

- 每次模型请求按 Judge 用量登记，与其它受管 Judge 共用费用、预算与取消路径。
- 一次会话的完整轨迹由它的各道评分题共享，每道题的审计引用同一份轨迹并保存自己的提交。轨迹包含评审实际收到的内容：每轮模型输出、工具调用参数、有限工具结果与截断标记、最终提交。截断前的原始文件和命令输出不属于完整轨迹承诺。`niceeval show @<locator> --assertions --entry <id>` 显示 measurement、理由与证据列表，`--full` 显示完整工具轨迹。
- 理由与证据是模型的自述，不证明引用对象存在、模型实际读到或判断正确。工具轨迹留存实际观察范围，供人复核（[T-12](../../taste.md#t-12)）。

### 不做什么

- 不提供只读模式或工具白名单配置。rubric 不是权限边界；需要限制权限时由 Sandbox 隔离配置承担，或改用确定性检查。
- 工具只得到当前主 Sandbox 的能力，不授予宿主文件或其它 Sandbox 的句柄。Provider 凭据留在宿主受管传输中，不注入 Sandbox。Sandbox 已有的挂载、网络与凭据权限仍由它的配置决定。
- 不把 Agent Judge 当作 `defineJudge` 的替代：材料已经齐全的判据继续用 `defineJudge`，它更便宜、更稳定。

### 验收

- 安装后的 CLI 运行一条带 Sandbox 的 Eval：评审读取被测 agent 写的文件并提交，Assertion detail 显示 measurement、理由、证据与工具轨迹；Judge 用量出现在 `show --usage`。
- 评审写入文件后，`show --diff` 仍只显示被测 agent 的改动。
- 评审不提交、超过轮次或期限、传输失败得到 unavailable；畸形模型协议与 HTTP 400 得到 errored。非法提交可修正；合法提交后同批工具与后续请求均为零。
- direct agent 的 Eval 登记 Agent Judge：登记时报 `judge.agent-requires-sandbox`。
- 声明 State、共享 Sandbox 的 Eval Group 或 `sandboxReuse` 的配对登记 Agent Judge：规划阶段报 `judge.agent-shared-sandbox`；Agent Judge 挂 `.stop()` 登记报错；普通断言的 stop 屏障不触发 Agent Judge。
- 一个会话的 chat、judge、judge 按调用顺序在同一个 pi 会话里处理，产生两个 entry、一份共享轨迹；某道题超轮次只有它为 unavailable，后续题照常评分。同一 Attempt 两个会话按登记顺序串行，后者能读到前者写入的文件。登记在它们之后的普通归因断言先执行，结果不含评审活动。
- 使用本地 OpenAI 兼容 HTTP server 脚本化工具往返，运行真实 pi Agent 与真实 Sandbox 工具；只模拟模型服务，不伪造 pi 事件或 Sandbox 结果。不调用付费模型。
- 确定性边界验收包含预算拒绝零发送、工具截断可见、模型超限不提交、TypeSafe 零发送、取消后零追加动作，以及失败与取消请求的 Judge 用量。
- 身份验收包含 rubric、预算、工具协议和生效模型改变后的重规划，以及未使用 Agent Judge 的既有身份不因新增默认字段漂移。历史审计保持原协议读取。

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
  readonly headers?: Readonly<Record<string, string>>;
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
  readonly judgeProvider?: JudgeProvider;
}
interface EvalJudgeSettings {
  readonly judge?: JudgeSelection;
}
interface ExperimentJudgeSettings {
  readonly judge?: JudgeSelection;
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
| `headers` | 随每次请求发送的额外 HTTP 头映射；键名大小写保留，值逐字发出并脱敏 | 无 |

未知字段、accessor 和非法选项在构造时拒绝。TypeSafe 不接受 `maxOutputTokens`，因为它的协议没有这一限制。
若宿主进程变量存在 `CF_ACCESS_CLIENT_ID` 与 `CF_ACCESS_CLIENT_SECRET`，Provider 在未显式声明同名头时自动追加对应 Cloudflare Access 服务头。
响应字节限制不等价于服务端生成量或费用限制。实际响应上限还受当前 Assertion 剩余审计容量约束。

### 模型与 Provider 替换

配置求值从 `Config.judgeProvider` 开始，依次应用 `Eval.judge` 和 `Experiment.judge`。
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
  judgeProvider: OpenAIProvider({ model: "judge-model", timeoutMs: 120_000 }),
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
import { defineJudge } from "niceeval/expect";
import { judgeImage, VercelProvider } from "niceeval/judge";

const quality = defineJudge({
  name: "action-quality/v1",
  rubric: "Evaluate the described behavior; use the screenshot as supplementary evidence.",
});
const provider = VercelProvider({
  model: "your-vision-and-tool-capable-model",
  supportsImages: true,
});
// Set Config.judgeProvider or Experiment.judge to this provider.
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
