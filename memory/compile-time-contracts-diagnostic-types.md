# 编译期作者契约:诊断类型三项裁决

裁决日期 2026-08-01。落点 `docs/roadmap/compile-time-contracts/`(README / library / architecture / use-case)。

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

## 同批否决:跨定义 template XOR 的静态前移

两条候选都不采用,资源前 linker 保持唯一权威(与 [[sandbox-layer-model-adopted]] 的配对级 XOR 一致):

- **值引用 selector**(`evals` 接受 Eval 定义值,kind 用条件类型互斥):给「选哪些 eval」开了第二种语义,与 CLI Model 的 id 前缀选择相抵。
- **codegen manifest**(discovery 生成 eval id → kind 的字面量表):引入生成物新鲜度环,与 tsx 直跑、零构建相抵。

## 未定:作者输入的公开名字

`EvalInput` / `ScoreEvalInput` / `ExperimentInput` 新名,还是保留 `EvalDef` / `ExperimentDef` 只搬走派生字段——这条没裁。它决定要改多少篇 Feature 文档与多少处导出,是这份 roadmap 进 `docs/feature/` 的唯一硬门槛。
