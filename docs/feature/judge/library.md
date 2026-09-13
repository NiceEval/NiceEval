# Judge —— Library

`niceeval` 导出 `defineJudge`，`niceeval/expect` 继续重导同一个工厂。它声明评分标准并返回受管 `JudgeDefinition`。root `t`、Session 与 Turn 都提供 `judge(value, definition)`；`check(value, definition)` 仍是同一统一登记入口。两者在当前 Attempt 捕获作者选择的材料并登记一次评分。

## 定义与调用

```ts
const followsIntent = defineJudge({
  name: "follows-intent",
  rubric: "根据 intent 评价 post 是否保留明确要求，没有编造未给出的时间。",
  anchors: [
    { measurement: 0, description: "偏离意图或编造关键信息" },
    { measurement: 0.5, description: "保留主要意图，但遗漏部分明确要求" },
    { measurement: 1, description: "保留全部明确要求且没有编造" },
  ],
});

export default x.defineScoreEval({
  judge: followsIntent,
  async test(t) {
    const intent = "邀请大家今晚在河边入口集合，不指定时间";
    const post = await t.post({ intent });
    t.judge({ intent, post }, followsIntent)
      .gate(0.8)
      .score(25)
      .label("发帖遵循意图");
  },
});
```

`t.judge(value, definition)` 只接受 `JudgeDefinition`，是 `t.check(value, definition)` 的薄包装。两者进入同一个 dispatcher，每次调用只产生一个 entry 和一次 evaluation；Provider 自己的模型重试预算保持不变。`judge` 不从 receiver 隐式挑选 `Turn.message`、transcript 或其它材料，Session／Turn 也必须显式传入材料。

普通自定义连续 Match 保持纯函数，不能执行 Judge I/O。质量 minimum、分值、标签、gate 与 stop 都属于登记后的 Assertion handle，不进入 Judge definition identity、rubric 或请求字节。

## 公开形状

```ts
interface JudgeAnchor {
  readonly measurement: number;
  readonly description: string;
}
interface JudgeOptions {
  readonly name: string;
  readonly rubric: string;
  readonly anchors?: readonly JudgeAnchor[];
  readonly maxMaterialBytes?: number;
}
interface JudgeDefinition {
  readonly kind: "judge-match";
  readonly name: string;
  readonly rubric: string;
  readonly anchors: readonly JudgeAnchor[];
  readonly maxMaterialBytes: number;
  // 私有品牌由 NiceEval 持有，调用方不能构造。
}
type JudgeDeclaration = JudgeDefinition | readonly [JudgeDefinition, ...JudgeDefinition[]];
declare function defineJudge(options: JudgeOptions): JudgeDefinition;
```

`name` 非空、最多 128 UTF-8 bytes，不含控制字符。`rubric` 是非空文本，最多 8 KiB。默认 anchors 描述 0 的不满足标准与 1 的完全满足标准。它们是连续质量量尺的端点，不是二元输出限制或模型置信度。显式 anchors 最少两个、最多 32 个，严格递增并包含 0 与 1；description 非空且各不超过 1 KiB。`maxMaterialBytes` 是正整数，默认 32 KiB，上限 48 KiB。未知选项、accessor 和非法值在定义时拒绝。

Eval 的 `judge` 声明单个定义或非空数组。允许列表在 Eval 创建时冻结，同一实例重复出现会去重，同名不同实例被拒绝。运行时使用的实例必须在该 Eval 的允许列表中，内容相同的新实例不能借用权限。按 name 排序后的完整定义与协议版本进入身份；列表顺序不改变身份，标准、anchors 或预算变化会改变身份。

## 登记顺序与材料快照

`check` 与 `judge` 首先同步检查作者入口仍开放、第二参数类型和当前 Eval 的 Judge 允许列表，再反射材料。关闭的入口、未声明的定义或错误的第二参数不会触碰 getter、Proxy trap、预算或 Provider。

材料接受字符串、有限数字、布尔值、null、数组、普通对象和 null-prototype 对象。只读取自有可枚举数据属性，省略对象内值为 undefined 的属性；根 undefined、数组空洞及 undefined 元素均拒绝。函数、BigInt、Symbol、class、getter、toJSON 和祖先链循环均拒绝；共享子对象可以在不同位置重复出现。反射失败拒绝输入；库不承诺隔离作者提供的 Proxy trap。

对象键按固定顺序排序，数组保序，字符串不 trim 或做 Unicode 规范化，负零规范为零。登记时完成 canonical JSON 快照，最大深度 32、遍历节点 16,384；修改原对象不改变请求。定义同样先有界校验再冻结。作者负责选择语义材料，NiceEval 证明快照与发送字节一致，不证明对象来自某个生产操作。材料只进入不可信 user message，rubric 与 anchors 进入 system message。模型输出不作为指令执行。

完整消息的 canonical JSON 最多 64 KiB，包括标准和材料。Attempt 内 Judge 请求的实际序列化留存总量最多 512 KiB。容量预留与 Assertion 登记同步成功；失败不创建 Assertion、不消耗预留、不调用 Provider。每次检查各自拥有快照，不暴露跨 Attempt 的材料句柄。

## 请求与读回

完整请求在登记时进入 Assertion 的受管材料 content，UTF-8 安全分块每块最多 4 KiB。分块只属于持久化表示。捕获发生截断时立即拒绝；材料、rubric 与 anchors 从同一固定请求读回，模型重试复用相同字节。新请求采用 v2 rendering、security 与材料 manifest，Decision 保持 `niceeval.llm-judge-decision/v1`。旧 v1 材料按原有持久化格式读取，不重新解释 provenance 或迁移已有 Record。

私有传输状态初始为 `not-sent`。实际 fetch 前检查取消，再同步标记 `attempted`；它只证明本地尝试交付，不证明服务端收到。预检不改变 Assertion 状态。成功、失败、超时和中断由共享 Attempt 封口路径捕获状态，封口后禁止更新或发起新请求。不可变材料只保存固定请求，传输状态属于结果。未调用 Provider 时不伪造发送事实。

Query 与 View 共用 v2 严格校验：精确结构、system/user 角色顺序、块数、字节限制、canonical 内容、协议及 digest 一致性。损坏材料标记 `invalid`，未知版本标记 `unsupported`，不回退为 v1；完整请求可通过公开 Assertion detail 读取。模型 rationale 与材料分开保留，材料不是模型返回的证据。URL 或 alt 不是视觉输入。

## Runtime 配置

Experiment 与项目配置的 `judgeRuntime` 只声明 Provider Profile：

```ts
export default defineConfig({
  judgeRuntime: {
    model: "judge-model",
    baseUrl: "https://gateway.example.com/v1",
    apiKeyEnv: "JUDGE_GATEWAY_KEY",
    timeoutMs: 120_000,
    maxOutputTokens: 512,
  },
});
```

Runtime identity 包含模型、端点、credential selector、超时、输出上限和 rendering/security/Decision 协议，不保存凭据值。完整配置先使用相同 forced-function Decision protocol 预检。模型或 key 缺失时不发网络请求，写入 `unavailable` 结果。端点不支持 tool 是 setup error；传输失败或超时为 `unavailable`，非法 Decision 为 `errored`，取消保持 Effect Interrupt。响应在 JSON parse 前受硬字节上限约束，只接受有限连续 `[0,1]` measurement 和非空 rationale。
