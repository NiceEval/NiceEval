# Eval —— Library

Eval 定义任务与判定，Experiment 选择连接评估对象的 Adapter，Attempt 独立执行一次任务。
Agent、游戏和普通应用都属于评估对象。Adapter 提供对象自己的操作与证据；会话是 Agent 接入提供的能力。

## 自定义应用

`defineAdapter` 从 `niceeval` 导出。作者在 `create(ctx)` 中返回一个普通对象，其字段与方法成为评估的 `t`。
框架不要求 `send`、统一请求格式或动作注册表，应用的方法名、参数与返回类型由作者决定。

```ts
const social = defineAdapter({
  name: "llm-x",
  async create(ctx) {
    const game = await createGame({ signal: ctx.signal });
    ctx.onCleanup(() => game.close());
    return {
      post: (input: PostInput) => game.post(input),
      reply: (postId: string, text: string) => game.reply(postId, text),
      visitDiscoveryPage: () => game.visitDiscoveryPage(),
      generateImage: (prompt: string) => game.generateImage(prompt),
    };
  },
});
```

工厂输入为 `name`、`create`，以及可选的 `behaviorRevision` 和 `assertions`。
`name` 和显式版本必须是非空字符串。版本声明应用行为可复用的边界；闭包或远端服务行为改变时必须更新它或实验配置。
未声明版本的用户应用不自动携带历史结果，避免把不可见的远端变更当作相同行为。

`create` 可以同步或异步返回应用上下文。TypeScript 从工厂的返回类型推导每份 Eval 的 `t`，不通过全局类型扩展注册方法。
上下文必须是普通对象；已有类实例通过闭包暴露所需方法，不直接展开实例或继承链。

## 执行上下文

```ts
interface AdapterCleanupContext {
  readonly signal: AbortSignal;
}

interface AdapterCreateContext {
  readonly evalId: string;
  readonly experimentId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<Record<string, JsonValue>>;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  log(message: string): void;
  onCleanup(cleanup: (context: AdapterCleanupContext) => void | Promise<void>): void;
}
```

`ctx` 提供执行配置、取消、反馈与资源释放登记，不提供应用操作或通用持久写入。
每个实际执行的 Attempt 创建一次上下文；carry 不创建实例。
应用应将 `ctx.signal` 传给执行阶段的工作，取得资源后立即登记 cleanup callback。注册成功才将释放义务交给框架。

cleanup callback 收到冻结的 `AdapterCleanupContext`。它的 `signal` 属于当前 `cleanup-open` 状态的 30 秒总预算，不是可能已经取消的 `ctx.signal`。
同一次 cleanup 的回调共享这个 signal。
回调可以在外部释放操作中传递该 signal，并在总预算结束时协作取消；现有零参数回调保持有效。
资源接管结束后的注册同步失败，作者仍须释放尚未移交的资源；完整边界见 [生命周期](architecture.md#应用实例生命周期)。

## 单一强类型 t

返回的 Adapter 提供 `defineEval` 与 `defineScoreEval`，两者的 `test` 都只接收一个 `t`。
`t` 合并当前评估类型的核心能力、只读应用上下文，以及在 Adapter 上声明的断言方法。作者不需要填写该泛型。

```ts
export default social.defineEval({
  async test(t) {
    const post = await t.post({ text: "今晚看流星雨" });
    const reply = await t.reply(post.id, "几点集合？");
    t.check(reply, repliesTo(post.id));
  },
});
```

应用未提供 `send` 时，调用 `t.send` 是类型错误。参数、返回值与泛型方法关系都保留，异步工厂不会丢掉推导。
`t` 根字段只读且固定；应用字段实时转发到原上下文，不保存浅拷贝状态。
方法绑定原上下文，解构后的调用仍有效；方法里的 `this` 不包含 NiceEval 的评估能力。
顶层应用方法在每次调用时检查作者生命周期，关闭后的调用明确失败。

公共上下文拥有以下成员，其签名与行为沿用 Assertion 和反馈契约：

| 成员 | 职责 |
|---|---|
| `evaluationKind` | 当前 Eval 的 `pass` 或 `score` |
| `check(subject, match)` | 登记值 Assertion |
| `group(title, body)` | 组织 Assertion 的 `groupPath` |
| `skip(reason)` | 停止当前 Attempt，形成显式 skip |
| `signal` | 当前 Attempt 的取消信号 |
| `model`、`reasoningEffort`、`flags` | 已求值实验配置 |
| `progress`、`diagnostic`、`log` | 当前执行的反馈 |
| `judge(value, match)` | 显式材料的受管 Judge Assertion；转交同一个 `check` 接收者 |
| `factuality`、`faithfulness`、`instructionFollowing`、`pairwisePreference`、`closeQA` | 现成 Judge 的直接入口；返回 Assertions 的 `MeasurementAssertionHandle<Kind>` |
| `score(points)` | 仅 Score Eval 的直接贡献 |

公共成员名不可被应用替换，`score` 在 Pass Eval 中也保留。
`then`、`constructor`、`__proto__` 与 Object 原型成员名同样不可作为应用根字段。
定义类型检查包含联合类型的每个分支；开放字符串索引不能证明无冲突，故不作为精确上下文接受。
运行时再次检查实际对象，JavaScript 调用者不能绕过重名与原型检查。
同步返回对象在 Promise 吸收前校验；异步工厂只校验实际兑现对象，不承诺逆转作者代码内已经发生的 thenable 吸收。

## 共享接口与选择实现

单个应用直接使用自己的 bound Eval factory。多个实现需要运行同一份 Eval 时，显式定义共同契约：

```ts
const social = defineAdapterContract<SocialContext>({ name: "social/v1" });
const baseline = social.implement({ name: "baseline", create: createBaseline });
const candidate = social.implement({ name: "candidate", create: createCandidate });

export default social.defineEval({
  async test(t) {
    t.check(await t.post("今晚看流星雨"), hasAuthor());
  },
});
```

`implement` 的输入为 `name`、`create` 与可选 `behaviorRevision`。
实现与契约的 bound factory 都只暴露 `SocialContext`，不因某个实现额外提供方法而扩大共享 Eval 的类型。
Eval 只绑定契约，不保存实现工厂。Experiment 的 `adapter` 选择实际实现。
运行时按共同的品牌契约配对，两个独立创建但名称相同的契约不能互换。
接口共享不授予不同实现自动携带结果的资格；名称与版本仅作为执行身份的一部分保存。

## Agent 会话特例

Agent 工厂提供相同的 bound Eval factory。根 `defineEval` 和 `defineScoreEval` 是 Agent 会话契约的便捷入口。
Agent 的 `t` 在公共评估能力上提供 `send`、`sendFile`、`newSession`、会话读取和作用域 Assertion。
它们属于 Agent 接入，不是所有应用上下文的必需成员。

| 能力 | 契约单源 |
|---|---|
| `send`、`sendFile`、`newSession` 与会话读取 | [Context](library/context.md) |
| Turn、Session 与 Agent scope Assertion | [Scoped assertions](../assertions/library/scoped-assertions.md) |
| Sandbox 文件、命令与变更归因 | [Sandbox operations](../sandbox/library/operations.md) |

普通应用动作不自动产生 Turn 或工具调用，也不继承 Agent 的消息重试。
未提供相应能力的应用与 Sandbox、Eval Group、Sandbox reuse 或完整应用费用 budget 的组合在创建资源前拒绝。
当前生命周期 Plugin 依赖 Agent 执行准备；普通应用配置这些 Plugin 会在预检失败，不会静默跳过其资源准备或释放。

## 对应用对象编写 Match

`t.check(subject, match)` 接受应用返回的 Post、Reply、Profile、图片信息或其它值。
Match 不拥有应用实例、动作派发或资源释放；`satisfies` 支持自定义同步或异步 Boolean 判定。

```ts
const repliesTo = (postId: string) => satisfies<Reply>(
  "回复关联正确",
  (reply) => reply.replyToId === postId,
);
```

Pass Eval 的 Boolean condition 默认参与 Verdict；连续 measurement 用 handle `.gate(minimum)` 建立显式质量门。

Score Eval 使用 `.score(points)` 或 `t.score(points)` 显式贡献分数，也可对 Boolean 调用 `.gate()`、对 measurement 调用 `.gate(minimum)`。gate 失败保留 earned score。

两者通过 Boolean `.orStop()` 或 measurement `.orStop(minimum)` 控制后续评估，并共用 [Assertions](../assertions/README.md) 的材料、求值和封口。Judge 可由 `t.judge(value, match)`、统一的 `t.check(value, match)`，或 `t.factuality(...)` 等现成直接入口登记。它们都只创建一个 `MeasurementAssertionHandle<Kind>`；Judge 费用不代表完整应用费用。

完整模拟社交平台示例见 [`examples/zh/llm-x`](../../../examples/zh/llm-x/README.md)。

## 自定义断言便捷方法

`assertions({ app, check })` 在 Adapter 定义处把应用证据与 Match 绑定。它同步返回普通对象，每个自有字段都是同步断言方法；方法返回本次调用中由 `check` 登记的原始 handle。

```ts
const social = defineAdapter({
  name: "social",
  create: createSocialContext,
  assertions({ app, check }) {
    return {
      hasPublishedText() {
        return check(app.readPublishedPost(), hasText);
      },
    };
  },
});

social.defineScoreEval({
  async test(t) {
    await t.post("今晚看流星雨");
    t.hasPublishedText().score(1).gate();
  },
});
```

`app` 只包含当前 Attempt 的应用接口，方法仍受作者生命周期保护。每次实际执行先完成 `create`，再组装一次断言方法；carry 不执行两者。
在方法调用时读取证据，避免将工厂组装时的旧状态当成动作后的结果。组装期间调用 `check` 报错。

这些方法与显式 `t.check(subject, match)` 共用判定、计分、诊断和报告。Pass 方法不提供 `.score()`；Score 方法保留它。Boolean 与 measurement 各自保留 `.gate()` 和 `.orStop()` 的参数与返回类型。
应用动作仍是普通操作，不会因为名称位于 `t` 上自动登记 Assertion。
断言方法使用具体调用签名；无法准确保留参数与结果关联的泛型或重载方法在绑定后的 `t` 上不可调用，不静默退化为宽类型。应用原生方法的泛型关系不受影响。

共享接口在定义处使用 `defineAdapterContract<Context>({ name }).withAssertions(factory)`，再由返回的契约定义 Eval 和各实现。返回契约拥有独立品牌；旧契约及其实现不自动取得新增方法。
所有实现共用该 factory，`implement` 不能替换断言定义。断言名不能与核心成员或应用字段重名，实际对象也在执行前校验。
断言对象不接受 getter、类实例、Promise、thenable 或非函数字段；方法不返回 Boolean、Promise 或其它调用留下的 handle。

封存与完整性检查由应用负责。断言方法不自动执行动作、等待或补跑；缺证据应抛出明确错误，不能转成匹配失败或空历史。取消或作者执行阶段结束后的应用方法、断言方法与 `check` 都拒绝继续调用。

## 封装自己的接入工厂

`defineAdapter` 定义接入方式，不创建业务应用本身。用户可以通过普通 TypeScript 函数封装 `defineTwitter`、`defineGame` 或其它领域工厂。
工厂返回原 Adapter 定义即可保留方法推导，不需要继承、全局声明合并或注册新的核心类别。
多个实现共享任务时，在封装模块创建并导出同一个 `defineAdapterContract`；不要在每次工厂调用时创建同名但独立的契约。

`defineAgent` 和 `defineSandboxAgent` 保留在 `niceeval/adapter`，提供第一方会话接入。
Experiment 的 `adapter` 接受这些定义；`agent` 是只接受 Agent 的便捷输入，两者不能同时提供。
结果和事件的 `adapter` 只有名称、接口名称与行为版本，没有可调用方法；方法只在本次 Attempt 的 `t` 上可用。
