# 给共享接口加**可选**字段:类型系统一次都拦不住,必须数着调用点逐个过

## 现象

`DiagnosticInput`(`src/runner/feedback/sink.ts`)加了 `code?: string`——为把「对外稳定词法」
从兼职折叠粒度的 `key` 里分出来(见
[diagnostic-key-doubles-as-json-warning-code](diagnostic-key-doubles-as-json-warning-code.md))。
四个调用/消费点漏改,**全部静默走回落分支**:

| 落点 | 漏的形态 | 静默后果 |
| --- | --- | --- |
| `src/runner/attempt.ts` | 转发诊断时不带 `code`(顺带也丢 `phase`) | attempt 级诊断的 `code` 全回落成复合 key,`phase` 恒缺席 |
| `src/sandbox/resolve.ts` | `fallbackFeedback` 不带 `code` | provider 诊断把复合去重串当稳定词法透出去 |
| `src/cli.ts` `assembleInvocationCompletion` | 记账仍按 `key` 前缀分类 | 身份一旦从 key 里摘走,记账悄悄归零 |
| `src/runner/feedback/eval-conclusions.ts` | 同上,按 `key` 前缀判 `fail-fast` | 同上 |

`pnpm run typecheck` 全绿,既有测试无一变红。四处分别被四个不同的 agent 在各自不相干的任务里
偶然逮到,没有任何一次是被工具发现的。

同一模式此前已经撞过一次:
[bivariant-method-shorthand-hides-missing-opt-plumbing](bivariant-method-shorthand-hides-missing-opt-plumbing.md)
——`Results.latest/current` 的 opts 加 `fresh?: boolean`,`src/results/open.ts` 的实现没跟改,
typecheck 照样绿(方法简写属性做双变检查)。加上本轮的四处,同一天同一形状共计五次。

## 根因

可选字段在类型层面对**每一个**参与方都是可省的,所以「没接住」与「有意省略」在类型上完全同形:

- **生产侧**(构造这个对象的调用点)漏填 → 合法省略,无报错。
- **消费侧**(读这个字段的地方)不读新字段、继续读旧字段 → 旧字段仍在,无报错。
- 两侧都有**回落分支**(`d.code ?? d.key.split(":", 1)[0]` 这类)时,漏改的行为与正确行为
  在大多数输入上**恰好相同**——只有当 key 里真的编了身份、或作者真的写了 `code` 时才分叉。
  测试用的多是简单 fixture,分叉输入正好不在里面。

回落分支不是设计缺陷(它让「干净字面量的诊断不必重复写一遍」),但它把「漏改」从**编译错误**
降级成**低概率行为差异**。必选字段会让 TS 在每个构造点报错,把普查变成免费的;可选字段把这份
普查工作整个转嫁给人。

## 修法

**加可选字段时,把「数调用点」当成变更的一部分,而不是可选的尽职调查。** 具体做法:

1. 加字段的那次 commit 里先 `grep` 出这个接口的**全部**构造点与消费点,列成清单贴进 commit
   message 或 plan;逐个判定「该填 / 有意不填」「该读新的 / 还读旧的」,不留未判定项。消费点
   尤其容易漏——生产点还能靠字段名 grep,消费点是「grep 旧字段名」才找得到
   (本例是 `grep 'd.key'`,不是 `grep 'd.code'`)。
2. **每个回落分支旁边写清回落条件**,让读代码的人一眼看出「不填时会发生什么」。`sink.ts` 的
   `code?` 与 `cli.ts` 的 `d.code ?? d.key.split(":", 1)[0]` 都补了注释说明缺省 key 恒是
   `${code}:${identity}`、首段即 code——补完之后同类漏改至少在 review 时可见。
3. **配一条真正跑该字段生效路径的行为测试**,不要以为 typecheck 绿就等于接住了
   (`bivariant-...` 那条的第 1 点已经写过同一句,本轮五次复发证明这句话需要升格成硬规则)。
4. 能做成**必选**就别做成可选。可选是给「大多数调用点确实不需要」的字段用的;如果预期是
   「几乎所有调用点都该填」,必选 + 显式 `undefined` 反而更省事——每个构造点强制表态一次。

落点:四处补漏分别在 `436090c5`(attempt.ts 的 code + phase)、`2e53660f`
(sandbox/resolve.ts 的 fallbackFeedback)、`eb1b05d8`(cli.ts + eval-conclusions.ts 改按 code 归类)。

## 适用场景

任何跨多个调用点的共享接口/回调签名新增可选字段时。判据:**这个字段有回落分支吗?**
有回落 = 漏改静默,必须普查;无回落(读到 undefined 就崩)= 至少还有运行时信号,风险低一档。
