---
format: concord.document/v1
id: score-eval-assertion-roles-not-orthogonal
title: 裁决：计分制里 points 与 severity 不正交，改成「一条断言只扮演一个角色」
createdAt: 2026-07-23T08:51:45+08:00
createdAtSource:
  kind: first-recorded
  path: memory/score-eval-assertion-roles-not-orthogonal.md
  commit: 74b88fa01658addfc259cb80beb4e9826cc76079
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---
# 裁决：计分制里 points 与 severity 不正交，改成「一条断言只扮演一个角色」

**日期**：2026-07-23（推翻 [pass-vs-score-eval-two-modes](pass-vs-score-eval-two-modes.md) 定稿时的第 5 条「判定面完全不变」）

**裁决**（契约落 `docs/feature/experiments/score-points.md`，severity 侧落 `docs/feature/scoring/architecture/severity-and-verdict.md`）：

1. **角色互斥，不是正交组合**。计分制里一条断言的角色由断言句柄上链的词唯一决定：`.points(n)` 得分点（进分数面）、`.gate(x?)` 前置（不进任何折叠读数）、不链词或 `.soft()` 观测（进质量分）。`.points(n).gate(x?)` 是「得分点兼前置」，是唯一的合法组合。读数落点两两不相交。
2. **`.points()` 之后只剩 `.gate()` / `.optional()`**：`.soft()` / `.atLeast(x)` 在计分制句柄上不存在（类型层拒绝）。设通过线用 `.gate(x)`。
3. **计分制的 `.gate()` = 前置中止**，不是「翻 verdict」：就地立即求值（普通断言仍延迟到 finalize），挂了在下一次 `t.*` 调用或 `test()` 收尾抛中止信号，写不写 `await` 结论一致。
4. **计分制的 `failed` 只有中止一个来源**：丢分不是失败，五步走三步的 attempt 是 `passed` 挣 3 分。verdict 在计分制回答的是「这次的分数完不完整」。
5. **计分制的 `t` 上没有 `t.require`**：`t.check(v, m).gate()` 覆盖它且能同时挣分。`t.require` 仍是通过制的前置词，不动。
6. **角色只从句柄读**：matcher 自带的默认 severity（`includes` 等默认 gate）与 matcher 上链的 `.gate(x)` 在计分制只贡献 threshold，不触发中止。
7. **落盘不加字段**：`severity` + `points` 的组合就是角色（得分点 = soft + 有 points，前置 = gate，观测 = soft + 无 points）；质量分按「soft 且无 points」取子集聚合。

**否决理由（原「正交」设计的三处硬伤）**：

- **旗舰例子自己踩了默认 gate**：`score-points.md` 检查点制示例的 `.points(1)` 断言没链 severity，默认就是 gate，于是「五步走完三步」的 attempt verdict 是 `failed`——计分制的整个前提是部分完成有部分分，判定面却把它标成失败。这是文档里活的 bug，不是理论问题。
- **`.points(n).soft()` 双读同一条证据**：质量分 = soft 断言分数的无权均值，带 points 的 soft 断言会同时进分数面和质量分。原契约（`docs/engineering/testing/unit/scoring.md` 的「可任意顺序组合」）从没裁决过这种情况。
- **计分制里 gate 没有读者**：榜单主列在计分制是总分不是通过率，「没挣到那 60 分」已经把排名压下去，再翻一次 verdict 是重复表达。

**曾选方案**：

- ~~`.points(n)` 默认等价于 `.soft()`~~——不够干净：soft 含「进质量分」这层含义，双读问题原样保留。
- ~~计分制里前置词叫 `.require()`（链式）而不是 `.gate()`~~——提出理由是 gate 在两个题型下行为不同（通过制翻 verdict 不中止 / 计分制中止不翻 verdict）读起来像词义漂移。用户否决：`ScoreAssertionHandle` / `ScoreTestContext` 本来就是另一套类型，两个 `.gate()` 是两个类型上的两个方法、各带各的 TSDoc，类型空间已经把它们分开了，不存在漂移。
- ~~计分制 verdict 收成三态（passed / errored / skipped）、中止另设标记~~——中止的 attempt 显示 `passed` 会误导；保留四态、把 `failed` 的唯一来源换成中止，读数更准且不引入新概念。

**落代码时的两处自我翻案（当天，均已同步回 docs）**：

- **`.atLeast(x)` 又加回来了，语义收窄成「观测的通过线」**。上面第 2 条按「低于线记 failed、`--strict` 下拖垮 verdict 在计分制没有落点」把它整个砍掉，漏了它还兼着**给 judge 这类没有默认线的打分断言设显示口径**。真实消费仓库（`NiceEval-Eval` 的 `evals/install/*.eval.ts`）的「装好了但产出质量差」那一档正是靠 `.atLeast(d.threshold)` 显示成失败行——砍掉后无法表达。现在它只决定这条记 passed 还是 failed，永不影响判定。教训：砍一个词之前先分清它承载了几件事，`.atLeast` 是「通过线 + strict 提级」两件，只有后一件在计分制没有读者。
- **`ScoreTestContext` 不能用 `Omit<TestContext, "require">` 实现**。那样它不再是任何 `TestContext<H>` 的子类型，跨题型复用的共享 helper（`evals/*/share/` 里那种）就没有类型可标注，消费仓库直接编译不过。改成拆出 `BaseTestContext<H>` / `BaseAssertionHandle` 作为公共部分，两种 `t` 各自 extends 后加自己的词（`require` / `score`），helper 标注 `BaseTestContext<H>` 同时接受两种 `t`。教训：**从一个类型上减成员**这件事，必须走「提取公共基类」而不是 `Omit`，否则减出来的类型会掉出原有的子类型关系。

**教训**：「A 与 B 正交」是个听起来永远正确的设计说法，但正交要求两个轴各自有读者。计分制里判定面这条轴已经被分数面顶掉了，还硬留着就会生出默认值陷阱（默认 gate）和双读（soft + points）。检查方法：把每条轴的读数落到具体报告列上，落不到列的轴就是多余的。
