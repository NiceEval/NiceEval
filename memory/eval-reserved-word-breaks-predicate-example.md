---
format: concord.document/v1
id: eval-reserved-word-breaks-predicate-example
title: eval-reserved-word-breaks-predicate-example
createdAt: 2026-07-19T11:40:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/eval-reserved-word-breaks-predicate-example.md
  commit: b2539d96af02251f5ecf2a3f1c22156231ad7f2c
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [eval-reserved-word-breaks-predicate-example](eval-reserved-word-breaks-p\
      redicate-example.md) — `eval` 是 strict mode
      保留绑定标识符,不能当参数名;`ExperimentDef.evals` 类型签名与 docs 示例原写成 `(eval) =>
      eval.id...` 会让用户抄示例直接语法报错,统一改参数名为 `e`(`src/runner/types.ts` +
      `docs/feature/experiments/{library,README}.md`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**:实现 `ExperimentDef.evals: (eval: EvalDescriptor) => boolean` 类型签名时,`tsc` 报
`TS1215: Invalid use of 'eval'. Modules are automatically in strict mode.`;docs/feature/experiments/library.md
与 docs/feature/experiments/README.md 的示例代码原本写的正是 `evals: (eval) => eval.id.startsWith(...)`。

**根因**:ECMAScript strict mode(ESM 模块恒为 strict mode)禁止把 `eval` / `arguments` 用作
BindingIdentifier——函数参数名、变量声明、catch 参数都不行。用 Node 直接验证:

```js
"use strict";
const f = (eval) => eval + 1; // SyntaxError: Unexpected eval or arguments in strict mode
```

这不是 TS 特有限制,是 JS 规范本身;任何用户如果照抄旧文档示例把参数命名为 `eval`,自己的
experiment 文件会直接语法报错,不是运行时才发现。

**修法**:类型签名与全部文档示例的参数名统一改成 `e`(与仓库里 `evals.filter((e) => ...)` 等
既有回调命名风格一致)。落点:
- `src/runner/types.ts` 的 `ExperimentDef.evals` 类型签名。
- `docs/feature/experiments/library.md`「evals:遍历发现结果，自定义选择」代码块 + 说明段落。
- `docs/feature/experiments/README.md` 的类型契约代码块。

**适用场景**:任何给用户回调设计类型签名或写文档示例时,参数名要避开 JS 保留标识符
(`eval`、`arguments`),哪怕它是最贴切的领域词——先用 Node/tsx 跑一遍字面示例代码,不要只凭
"TS 编译期类型检查通过"就当作示例代码合法(类型签名与实际调用是两回事,后者才会触发这个限制)。
