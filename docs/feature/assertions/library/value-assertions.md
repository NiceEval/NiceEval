# Assertions —— value assertions

值比较的共同模型在 [Assertions](../README.md)。`check(subject, match)` 在调用时读取传入的 subject 并直接登记 Assertion。
root `t`、Session 与 Turn 都提供这一入口。

## 两个参数

```ts
const parsed = t.check(rawConfig, matches(ConfigSchema))
  .label("配置符合 schema");
```

`check(value, match)` 比较显式 subject；`check(contextualMatch)` 在求值时注入当前应用只读 ctx。
值 Match 只比较传入的 subject；它没有 callsite、subject identity、groupPath、score、threshold 或控制流。
ctx reader 由 `defineContextMatch` 或 `defineMaterialMatch` 声明。
受管 `toolCalls` 是合法 subject；collection Match 见 [Scoped assertions](scoped-assertions.md)。

`check` 保存已求值 value 的安全 snapshot 或 ref，而不是只保存 Match 的成功 / 失败。命令结果等大型 subject
的字段要求见 [Evidence · 显式 value snapshot](../architecture/evidence.md#显式-value-snapshot)。

## 数值比较

`niceeval/expect` 公开四个 Boolean matcher。工厂 threshold 必须是有限 number；非法 threshold 在调用 matcher 工厂时就是作者错误。非 number candidate 可以作为调用错误拒绝；candidate 已经是 number 但值为 `NaN` 或正负 `Infinity` 时，这条 Assertion 形成 unavailable，不能记为作者错误或普通 mismatch。

```ts
declare function lessThan(threshold: number): BooleanMatch<number>;     // candidate < threshold
declare function atMost(threshold: number): BooleanMatch<number>;       // candidate <= threshold
declare function greaterThan(threshold: number): BooleanMatch<number>;  // candidate > threshold
declare function atLeast(threshold: number): BooleanMatch<number>;      // candidate >= threshold
```

```ts
t.check(latencyMs, lessThan(1_000)).label("延迟低于一秒");
t.check(successRate, atLeast(0.95)).label("成功率至少 95%");
t.check(-1, lessThan(0)).label("负数小于零");
```

generic numeric matcher 允许负 threshold 与负 candidate。非负约束只属于 Usage token／cost scope material，以及 pricing receipt 中的 token count、rate 和 amount。

这里的 `atLeast(0.95)` 是 numeric Boolean Match，负责比较 `t.check` 提供的 number subject。连续 `ScoreMatch<T>`
没有 `.atLeast()`；作者在登记后的 measurement handle 上用 `.gate(minimum)` 或 `.orStop(minimum)` 建立唯一的 `[0,1]` condition。

四个 matcher 都登记 `numeric-comparison/v1` criterion。`value-match/v1` 只表示没有可解释数值运算的旧值比较；reader 不从 matcher 名、observed number 或展示文本推断升级它。

## 值与集合组合

公共组合器返回普通值 BooleanMatch，复用 `check` 的同一求值器、handle 和诊断。
应用语法糖负责读取正式事实，组合器不会读取 ctx 或寻找材料入口。

```ts
type CollectionValue<T> = readonly T[] | MaterialCollection<T>;

declare function mapValue<T, U>(
  label: string, project: (value: T) => U,
  match: Match<NoInfer<U>, "value"> & { readonly kind: "boolean" },
): BooleanMatch<T, T>;
declare function mapEach<T, U, S extends CollectionValue<T>>(
  project: (value: T) => U,
  aggregate: Match<CollectionValue<NoInfer<U>>, "value"> & { readonly kind: "boolean" },
): BooleanMatch<S & CollectionValue<T>, S>;
declare function filterWhere<T, R extends T, S extends CollectionValue<T>>(
  selector: BooleanMatch<T, R>, aggregate: BooleanMatch<CollectionValue<R>, CollectionValue<R>>,
): BooleanMatch<S, S>;
declare function countWhere<T, S extends CollectionValue<T>>(
  item: BooleanMatch<T, NoInfer<T>>, count: Match<number, "value"> & { readonly kind: "boolean" },
): BooleanMatch<S, S>;
```

普通数组表示完整集合。`MaterialCollection` 明确区分 complete、partial 和 unavailable；投影保持选中项的身份与顺序。
计数、筛选与批量投影先检查集合完整性。partial 或 unavailable 不执行子 Match，也不把已知小计当成 exact count。
complete empty 的计数是零。数组空洞、缺失值、null、NaN 和 Infinity 是未知项，不补零，也不作为普通不匹配跳过。

`filterWhere` 将同一项交给 selector，全部确定命中项按原顺序交给 aggregate。
任一项不可判定时，全组不可判定，不把未知项筛掉后声称完整。
`countWhere` 将完整集合中的每项交给 item，再将确切命中数量交给 count。
`mapEach` 对每项执行同步只读投影，投影集合交给 aggregate；`mapValue` 对单个值执行相同投影契约。
缺失或非有限投影产生 unavailable；其他合法值的判断交给内层 Match。

组合诊断保留子 Match 的状态、原项位置、事件身份和聚合结果。投影与子 Match 的异常继续上报为执行错误，不能吞成不匹配或未知。
返回值 refinement 始终是原 subject，不把计数、筛选所得集合或投影值冒充原事实。

### 通用集合顺序

`inOrder` 接受普通值 BooleanMatch 的序列，返回可由 `and/or/not` 组合的普通集合值 Match：

```ts
declare function inOrder<T, S extends CollectionValue<T>>(
  steps: readonly [BooleanMatch<T, NoInfer<T>>, BooleanMatch<T, NoInfer<T>>, ...BooleanMatch<T, NoInfer<T>>[]],
): BooleanMatch<S, S>;
```

步骤数量为 2–64。EventMatch 与 ToolMatch 的既有重载保留各自受管集合语义，不能与普通值 Match 混用。
上下文 Match 不直接作为步骤；应用先用一个 ctx reader 取得同局完整事件流，再将集合交给此 Match。
数组位置必须来自应用正式提交顺序，框架不读取请求派发时间、不排序、不推测跨应用因果。

顺序表示严格递增位置的子序列，不要求相邻；同一项不能满足两个步骤。
每个步骤内部的 `and` 约束同一项；业务确实允许多个顺序时，可用 `or` 组合不同序列。
双方都有发言及实际听者不需要顺序，应分别检查两条存在性命题；只有“听闻后移动”等明确先后要求才使用此组合器。
完整空集不能满足两个步骤。partial 或 unavailable 集合在求值步骤前返回 unavailable。

完整集合内，已知见证链足以 matched；不存在可能链时 mismatched；只有包含未知项或未知步骤的可能链时 unavailable。
数组空洞、缺失值、null 和非有限数是未知候选，不能作为普通 mismatch 丢弃。
实现区分确定与可能的可达前缀，逐项从后向前推进步骤，禁止用同一事件推进多个步骤。
每个相关候选/步骤最多求值一次。子 Match 异常原样上报，不转成未知；诊断保留原位置、稳定材料 ID、步骤位置与子诊断。
refinement 保留原集合类型，不返回匹配项或另建材料读取入口。

```ts
t.events(inOrder([
  and(npcMatch({ id: "a" }), sayMatch({ heardBy: "b", modelVerified: true })),
  and(npcMatch({ id: "b" }), modelMatch({ outcome: "succeeded" }),
    decisionMatch({ outcome: "adopted" }), operationMatch({ ids: ["move"] })),
])).gate();
```

此例只证明听闻后采用移动决策；实际移动完成仍需应用的正式执行回执，不能由采用推断。

验收包含相邻与非相邻见证、反序、重复步骤必须不同项、替代序列 `or`、已知链与未知竞争链、未知才可能成链、完整失败、partial 零子求值、异常与诊断。
真实作者类型同时验证数组与 MaterialCollection、ctx reader 的集合 Match 参数，以及无显式泛型的 `inOrder([equals(1), equals(2)])`。

```ts
t.hp(npcMatch({ ids }), countWhere(equals(0), equals(3))).gate();
const 未决胜 = actorsAtEndMatch(countWhere(存活者, not(equals(1))));
t.systemOne(and(参赛者, or(未决胜, 存活者), modelMatch(...), decisionMatch(...), operationMatch(...)));
```

`actorsAtEndMatch(inner)` 在应用层用 `mapValue("末态人物", event => event.actorsAtEnd, inner)` 封装正式末态投影。
末态判据与战术评分是独立断言；集合组合器不引入胜负条件或改变未决局计分。

## refinement

Boolean Match 可以 refinement 原 subject。需要中止当前 continuation 时，在同一 handle 上 await
`.orStop()`：

```ts
const config = await t.check(rawConfig, matches(ConfigSchema))
  .label("配置有效")
  .orStop();

config.name.toUpperCase();
```

这不会登记第二条 Assertion。catch 不会清除 stop latch，之后的 NiceEval 作者 API 会拒绝登记。

## measurement

连续 `ScoreMatch` 返回 finite `[0,1]` measurement。Pass 与 Score 都可在登记后的 handle 上用 `.gate(minimum)` 让低于最低值的结果进入 failed；不调用 gate 时只保存 measurement。
Score Eval 还可用 `.score(points)` 按 measurement 贡献分值，并与 gate 任意先后组合。同一个 evaluator 只运行一次，具体计分见 [Score Eval](score-points.md)。
