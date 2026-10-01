# 材料验收问答 —— Library

`niceeval/expect` 导出 `defineMaterialSource`、MaterialSource、MaterialSelector 和 MaterialCollection。

source 工厂是不可变 callable；调用只构造 selector，不读取应用，不执行 Match。

```ts
interface MaterialItem<T> { readonly id: string; readonly value: T }
type MaterialCollection<T> =
  | { readonly state: "complete"; readonly items: readonly MaterialItem<T>[] }
  | { readonly state: "partial"; readonly items: readonly MaterialItem<T>[]; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };
interface MaterialSource<T> {
  readonly name: string;
  (match: BooleanMatch<T, T>): MaterialSelector<T>;
}
interface MaterialSelector<T> { readonly kind: "material-selector" }
declare function defineMaterialSource<T>(options: { readonly name: string }): MaterialSource<T>;
```

source 和 selector 有模块私有品牌，手造对象不能使用。

同一个 source token 的绑定仅属于本 Attempt。

每项 ID 为非空字符串、最多 128 UTF-8 bytes；同一 collection 内唯一。

顺序原样保留，value 包含消费者原始字段，不新增领域格式。

Adapter factory context 增加如下方法，只可在同步 factory 组装阶段调用；此时只登记 read callback，不执行它。

```ts
bindMaterialSource<T>(source: MaterialSource<T>, read: () => MaterialCollection<T>): void;
```

同一 source token 或名称重复绑定拒绝。

read 在 closeQA 调用处同步执行，并立即安全快照；不补动作、不等待、不扫描 app。

方法调用仍走 guarded app 和作者阶段边界。

共享 Adapter contract 的 withAssertions 定义同一绑定；实现只替换 app 原生取数。

```ts
const saidMatch = defineMaterialSource<Event>({ name: "speech" });
const app = defineAdapter({
  name: "application",
  create: createApplication,
  assertions({ app, bindMaterialSource }) {
    bindMaterialSource(saidMatch, () => app.readSpeech());
    return {};
  },
});
app.defineScoreEval({ test(t) {
  t.closeQA(saidMatch(and(actorMatch("a"), speechMatch())),
    "这些发言是否自然且完整？").gate(0.8).score(30);
} });
```

closeQA 只有材料验收问题形态。

旧的材料答案评估 overload、closeQA 工厂和 CloseQAMaterial 类型移除：

```ts
closeQA<T>(selector: MaterialSelector<T>, question: string,
  options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
```

question 是只根据匹配材料回答的验收问题，非预设答案。

非空、最多 8 KiB。

options 沿用 name/maxCalls/maxMaterialBytes/maxAuditBytes。

新算法对整组材料只做一次分类：satisfied 为 1，not-satisfied 为 0，insufficient-evidence 为 unavailable。

完整空集得到 measured 0 且零模型调用；不把日志缺失或模型无法判定当零。

普通 defineValueMatch callback 增加 `{ state: "unavailable", reason: string }` 返回形状，保留 Boolean/refinement。

and 在同一 item.value 上求值。

全部候选都被判定，不筛 accepted、成功或符合预期内容的样本。

partial collection 或任何 item 判定 unknown 都不能证明全部命中材料，整条 measurement unavailable，零模型调用。

命中材料保留全部原始 item，包括失败和未采用日志条目、ID、顺序、原文及回执。

不能裁剪后评分，超限保留 unavailable。

模型不得引入外部知识或把材料当指令。

问题、源名称、predicate 声明、selection receipt、命中材料和实际 Judge 请求均保留。

受管 classify 增加可选 evidenceIds 输入；聊天协议响应包含 citations，必须是提供 ID 的无重复子集。

新增问题算法使用该形状。

其它 classify 不请求 citations，协议保持原形状。

TypeSafe 未提供引用时沿用其分类结果，引用标记 not-recorded，不生成模型理由或引用。

ScoreMatch measured result 可携带 citations，已有 Assertion detail 的 citations 字段保存真实返回值。

root、Session、Turn 都提供同一 closeQA 形态；其它 Judge 的显式材料入口保留。

自定义 source 注册复用 Adapter 生命周期；工具/事件已有 scope 查询与 Match 不改变。

新的普通 source 不伪装 managed tool/event subject。

后续领域包装必须通过各自 owner 投影事实、完整性与 ID 后绑定相同 source 协议。

Agent 与显式材料使用同一个 selector 协议；materialMatch 绑定传入的事实应用数据输入，不隐式读取 ctx。

```ts
declare function materialMatch<T>(collection: MaterialCollection<T>,
  match: BooleanMatch<T, T>): MaterialSelector<T>;
declare function materialMatch(collection: ManagedToolCalls,
  match: ToolMatch): MaterialSelector<ToolOccurrenceView>;
declare function materialMatch(collection: ManagedEventOccurrences,
  match: EventMatch): MaterialSelector<EventOccurrenceView>;
turn.closeQA(materialMatch(turn.eventOccurrences, eventMatch("message", { role: "assistant" })),
  "全部发言是否给出了明确可执行的步骤？").gate(0.8);
```

两种构造均只绑定材料输入和 item Match，不执行 Match；check 与 closeQA 是两种明确的消费入口。

工具/事件 selector 保留 scope sidecar、source locator 与 session ID，逐候选判定沿用 collection owner 的 query evaluator。

原始候选按 scope 顺序保留，来自多个 Session 的项显式带 Session ID，不能伪造全局对话顺序。

## 存在性与同源复用

```ts
check<T>(selector: MaterialSelector<T>): BooleanAssertionHandle<Kind, void>;
```

check 的一参数形态只接受正式 MaterialSelector；普通 check(subject, match) 继续接收两个参数。

存在性默认至少一项，无 count 选项；返回 void refinement，不能把部分命中当完整材料集合交给其它 evaluator。

存在性与 closeQA 使用同一 source 身份查找、冻结候选和单项求值。

完整空集 mismatched；有确定见证即 matched；其余 partial/unknown 为 unavailable。

```ts
assertions({ app, check, bindMaterialSource }) {
  bindMaterialSource(systemMatch, () => app.readEvents());
  return { system(match: BooleanMatch<Event, Event>) {
    return check(systemMatch(match));
  } };
}
t.system(and(actorMatch("a"), speechMatch())).gate();
t.closeQA(systemMatch(actorMatch("a")), "这些事实是否证明实际参与？").score(30);
```

每次声明在自己的调用处读取 source 并登记独立 entry；同源不是跨声明共享可变结果或自动 memoization。

候选固定界限、读取事务、Attempt 总账和 citation reader 的完整规则见 [Architecture](architecture.md#review-修订四类容量)。

## 官方用量与耗时材料

Adapter-neutral core 提供下列入口：

```ts
usageSnapshot(): AttemptUsageSnapshot;
elapsedMs(): NumericMaterial;
maxTokens(max: number): BooleanAssertionHandle<Kind, void>;
maxCost(usd: number): BooleanAssertionHandle<Kind, void>;
```

usageSnapshot 捕获调用时的当前 Attempt 官方账本，不读取应用 journal。

快照包含 source=`adapter`、scope=`recorded-calls`、cut、calls、collection 与 priceReceipts。

inputTokens、inputTotalTokens、outputTokens、cacheReadTokens、cacheWriteTokens 与 totalTokens 都是 NumericMaterial。有效成本按币种保存。

每个物理 callId 只计一次，失败和重试均保留。

totalTokens 每次优先使用 inputTotalTokens，否则互斥输入/缓存桶之和，再加 outputTokens，不重复计输入总数。

缺失分量使总量成为 lower-bound；没有任何已知分量则 unavailable，不补零。

所有值保留非负 safe-integer约束。

有效成本优先 reported（包括0），否则使用同一 collector 生成的显式 pricing receipt；不读内置价格、不在 eval 重定价。

按币种保留 canonical decimal、reported/estimated/mixed应用数据输入、完整性。

maxCost 参数明确 USD；其它币种不兑换，缺失、partial 给 lower-bound 或 unavailable，不能当完整USD账单。

快照描述已上报调用，不证明所有未来请求已完成；cut 标记 call-time，maxTokens/maxCost 只约束该范围。

cleanup 晚到上报影响最终Record，不追溯修改已登记的断言。

`t.check(t.usageSnapshot(), customMatch)` 支持自定义计分。

`const usage = t.usageSnapshot(); if (usage.source === "adapter") t.check(usage.totalTokens, atMost(limit))` 通过 NumericMaterial 正式 overload 使用三值边界判断。

maxTokens 复用 numeric primitive；maxCost 用精确 canonical decimal 比较 USD阈值，不经number损失精度；两者不另建账本。

Agent 原有 usage/maxTokens/maxCost 的 scope 语义保持。

Agent 未绑定逐物理调用owner时，usageSnapshot 显式返回 source=unavailable/reason=usage-owner-not-bound。不从Adapter推断Agent。

elapsedMs 捕获 Runner monotonic Attempt origin 到当前调用的毫秒，含 setup 与作者等待，不含尚未发生的 cleanup；material 的 cut/scope/unit 明确。

它不表示游戏时钟或首次胜者时间，后者由 app source 拥有。

请求/Turn 时间仍由各自 timing owner 提供，不能用 Attempt elapsed冒充。
