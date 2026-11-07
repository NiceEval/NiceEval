# 编译期作者契约:四项裁决

裁决日期 2026-08-01。落点 `docs/feature/compile-time-contracts/`(README / library / architecture / use-case)。

## 裁决 1:禁止字段按「会不会被读回」分两种写法

- **只作输入、不会从这个类型上被读回的字段** → 模块私有诊断类型。
- **union 成员的负字段、消费侧要读同名字段** → `never`。

曾考虑全用 `never`(原 roadmap 的写法),也考虑过全用诊断类型。两条都被实测否决。

实测(`tsc --noEmit --strict --pretty false`,自制最小复现):

```text
# id?: never
Type 'string' is not assignable to type 'undefined'.

# id?: IdComesFromFilePath(诊断类型)
Type 'string' is not assignable to type 'IdComesFromFilePath'.
```

全用 `never` 的问题:`undefined` 不说明这个字段为什么不能填,而 `id` / `scoring` / `configHash` 恰是作者最常照旧习惯写的三个。

全用诊断类型的问题在消费侧。`url?: never` 时 `server.url` 是 `string | undefined`;换成诊断类型就变成 `string | UrlBelongsToHttpTransport | undefined`,作者面的措辞漏进读取侧,union 分支收窄也多一层。

## 裁决 2:关系泛型用诊断辅助类型,不退回 `never`

原 roadmap 留了后路:「若 TypeScript 展示结果过长,则退回 `never` 约束」。实测证明不需要后路。

```text
# NoAggregateKeyConflict 用诊断类型:两行,带冲突键名
error TS2345: Argument of type '{ by: {...}; values: {...}; }' is not assignable to parameter of type '{...} & AggregateKeyDiagnostic<"agent">'.
  Property '[CONTRACT_DIAGNOSTIC]' is missing in type '{...}' but required in type 'AggregateKeyDiagnostic<"agent">'.

# evidenceRow 参数整体替换成 never:一行,不说缺什么
error TS2345: Argument of type '{ agent: string; }' is not assignable to parameter of type 'never'.
```

连带改法:`WithMetricField` 从「替换整个参数类型」改成「与 `Fields` 交叉」。参数保持 `Fields` 才有字段级补全,缺读数时报的是缺诊断属性,而不是 `not assignable to parameter of type 'never'`。

诊断类型共用一个不导出的 `CONTRACT_DIAGNOSTIC` symbol,字面量属性值只服务于阅读,不产生运行时字段。

## 裁决 3:动态数据走 `parseEvidenceRow()`,不给宽对象留 overload

曾选方案是给 `evidenceRow()` 加一个接收宽对象的 overload。否决理由:普通的写错对象会顺着宽签名逃回运行时,那条 overload 会变成所有人的默认写法。

定稿分工:字面量写 `evidenceRow()`(编译期证明 + 精确行类型),外部数据写 `parseEvidenceRow()` / `parseEvidenceRows()`(运行时证明 + 统一 `EvidenceRow`)。

## 裁决 4:阶段类型各有其名,`Def` 后缀退出公开类型

采用 `EvalInput` / `ScoreEvalInput` / `ExperimentInput`(作者输入)、`EvalDefinition<Scoring, Context>` / `ExperimentDefinition`(factory 产物)、`DiscoveredEval` / `DiscoveredExperiment`(带 id 的发现结果)。

曾选方案:保留 `EvalDef` / `ExperimentDef` 这两个名字,只把 `id` / `scoring` / `configHash` 搬出去,另给输入起 `EvalInput`。

否决理由有两条。一是 `Def` 今天同时指作者输入、`defineEval` 返回值和 `DiscoveredEval` 的基类(`src/runner/types.ts` 的 `EvalDef` 一个 interface 三处用),名字不携带阶段信息,而拆阶段的动机正是把这三者分开。二是保留名字会让含义悄悄改变:`EvalDef` 从「三合一」变成「factory 产物」,凡是把它当作者输入讲的段落静默变错,读者不会意识到该看新名字。

改动面实测(裁决当时):活文档 24 个文件 45 处提及,`docs/design/PLAN-*/` 里的 61 处历史方案不动,`examples/` 零处,导出面是 `src/index.ts` 两行。这批文档同批扫完,规则是——讲「作者能写什么」用 `*Input`,讲字段与消费用 `*Definition`。

同批的副产品:`defineScoreEval` 的返回类型从宽 `EvalDef` 收窄成 `EvalDefinition<"points", ScoreTestContext>` 之后,`src/define.ts` 里那个用来在运行时找回题型的模块私有 WeakSet(`definedScoreEvals`)不再是类型层丢失信息的补偿。

## 同批否决:跨定义 template XOR 的静态前移

两条候选都不采用,资源前 linker 保持唯一权威(与 [[sandbox-layer-model-adopted]] 的配对级 XOR 一致):

- **值引用 selector**(`evals` 接受 Eval 定义值,kind 用条件类型互斥):给「选哪些 eval」开了第二种语义,与 CLI Model 的 id 前缀选择相抵。
- **codegen manifest**(discovery 生成 eval id → kind 的字面量表):引入生成物新鲜度环,与 tsx 直跑、零构建相抵。
