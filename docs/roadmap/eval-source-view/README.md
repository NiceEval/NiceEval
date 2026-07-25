# 源码调用树：eval 源码分布在多个文件时的展示

这是尚未定为当前契约的候选设计，见 [Roadmap 约定](../README.md)。终端契约见 [CLI](cli.md)，装配算法与降级见 [Display](display.md)，数据模型、捕获规则与 web 面投影见 [Architecture](architecture.md)。它替换的当前契约是[`--source`：把断言放回源码](../../feature/reports/show/eval-source.md)与 [`AttemptSource`](../../feature/reports/components/attempt-detail/README.md)的单文件假设。

## 问题

「源码即报告」这条叙事建立在一个假设上：一个 attempt 的判定痕迹都写在一个文件里——[`AnnotatedEvalSource`](../../concepts.md) 是一份源码加一列按 `loc` 标回去的标注，`loc` 落不进这份源码的断言进「未映射断言」兜底桶。

题库长大之后这个假设不成立。共享判定逻辑抽进 helper 是题库变多之后的必然形态：五道题要用同一套「装没装上」判据，判据就住进一个 helper，eval 文件退化成一根调用主干。`/Users/ctrdh/Code/NiceEval-Eval` 的 install 组是这个形态的实测样本：

```text
evals/install/gpt-researcher.eval.ts        134 行   ← 主干:事实常量 + 一次 send + 七行 helper 调用
evals/install/share/eval-install.ts         343 行   ← 判定住这里
evals/install/share/eval-adapter.ts         200 行
evals/install/share/eval-sandbox.ts         151 行
evals/install/share/quality-criteria.ts     114 行
evals/install/share/eval-experiment.ts      105 行
evals/install/share/eval-authoring.ts        84 行
lib/candidate.ts / lib/routing.ts           213 行
```

eval 文件里只有 `t.judge`、`t.calledTool` 十来条，`t.check` 一条没有；四十多条判定的 `loc` 全部指向 `share/` 下的 helper。当前契约下 `--source` 因此退化成最坏形态：整整一屏没有一处标注的主干源码，后面跟一个装着全部断言的兜底桶——源码视图既没告诉读者哪条失败，也没告诉读者失败发生在哪一步，还比 [`AttemptAssertions`](../../feature/reports/components/attempt-detail/README.md) 的平铺列表多花了一屏。

天真的修法是把引用到的文件全部倒出来：这次 attempt 会得到 1300 行源码，读者要自己在文件之间重建「哪次调用触发了这条断言」。而这恰好是读者唯一真正想要的信息——`evalInstall` 里那条 `t.check(version, satisfies(...))` 红了，读者要问的不是「eval-install.ts 第 246 行长什么样」，是「我这道题的第 98 步『评估安装』没过」。

## 目标模型：源码是一棵调用树，不是一个文件

判定痕迹的骨架是**调用路径**，不是文件。因此展示单位从「一份源码 + 标注列表」改为一棵树：

- **主干（spine）**：eval 入口文件里 `defineEval` / `defineScoreEval` 调用覆盖的行范围，总是完整显示。它是读者的地图，读起来仍然像一份脚本。
- **枝（callee 片段）**：一条断言的 `loc` 落在别的文件时，它不进兜底桶，而是挂到调用链上——从主干出发的那一行下面，缩进内联被调文件的**片段**（标注行加少量上下文，中间省略），片段内再有跨文件调用就再缩进一层。
- **汇总行**：每个跨文件调用行下面先给一行汇总——被调文件、检查条数、通过／未通过、计分制的挣分。全通过的路径只留这一行；含未通过、丢分或前置中止的路径默认展开片段。注意力预算因此跟着失败走，不跟着源码体量走。

同一份 attempt 在这个模型下读起来是：

```text
 97      await evalInteraction(t, { clarify: CLARIFY, turn });
       ↳ share/eval-install.ts · 6 checks · 6 ✓ · 4/4 pts
 98      await evalInstall(t, { version, standaloneWorkspace: true });
       ↳ share/eval-install.ts · 11 checks · 9 ✓ 2 ✗ · 7/11 pts
       │ 245✓     t.check(root !== null, isTrue("niceeval.config.ts 存在"));
       │ 246✗     t.check(
       │        gate · 评估安装 · satisfies(依赖解析到候选包 niceeval@0.11.0)
       │        expected 依赖解析到候选包 niceeval@0.11.0 · received "0.10.3"
```

完整终端形态、省略规则、`--source=full` 与 `--source=<path>` 见 [CLI](cli.md)。

这条设计带来三处契约变化，逐条见 [Architecture](architecture.md)：

1. **`loc` 记调用链，不只记声明处。** `AssertionResult.loc` 增加从 eval 入口到声明处的用户帧链，树才有骨架可挂。
2. **源码捕获跟着调用链走。** [`sources.json`](../../feature/results/architecture.md#sourcesjson) 收录链上每个用户帧的文件，「用户帧」有精确定义（排除 niceeval 自身与 `node_modules`）。
3. **`AnnotatedEvalSource` 变成递归结构。** 一个节点是「一个文件的若干行 + 每行的标注 + 每行发出的调用子树」，text 面与 `AttemptSource` web 面共用这棵树。

## 兜底桶还在，但只接真正无处安放的

树把「loc 在别的文件」这一类从兜底桶里拿走了。剩下两类仍然不静默丢弃：

- **没有 `loc` 的断言**：动态构造、或由 adapter 内部产生，平铺成一列，形态与 [`AttemptAssertions`](../../feature/reports/components/attempt-detail/README.md) 的条目一致。
- **调用链不经过主干的断言**：例如判定发生在 setup hook 或另一个入口里。它们按最外层用户帧的文件分组，仍然以片段形式呈现，排在主干之后而不是塞进主干中间——源码即报告的待遇不因为挂不上主干就取消。

## 非目标

- **不做运行时栈的通用展示。** 这棵树只承载判定痕迹（断言、给分记录、`t.send`）的归属。`assertPagesInCandidate()` 这类直接抛错中断 attempt 的用户代码由 [`AttemptError`](../../feature/reports/components/attempt-detail/README.md) 呈现，不进源码树。
- **不做跨 attempt 的源码对照。** 树的输入恒为一个 attempt 的证据。
- **不改判定语义。** 树只改「标注挂在哪、展开多少」；判定、`expected` / `received` 收口、never-drop 契约照 [Scoring · 断言与 Turn 的展示](../../feature/scoring/library/display.md)不变。
- **不改轮次的诊断面。** `t.send` 行的头行事实照旧标在源码上，轮次全量清单仍在 [`--execution`](../../feature/reports/show/execution.md)。

## 待裁决

- **主干的边界。** 主干取 `defineEval` 调用的行范围，文件顶部的 import 与事实常量（`EXPECTED_PAGES`、`QUALITY` 这类）不在主干里；它们不承载标注，但确实是读懂断言的背景。候选是「主干 = 定义行范围，文件其余部分按省略规则可展开」与「主干 = 整个入口文件」。
- **第三方包里的 helper。** 题库共享判据发成 npm 包之后，`node_modules` 里的帧默认不捕获，链上折叠成一条不可展开的 `(package: <name>)` 标记。是否给一个 `sources.include` 白名单让作者把自己的题库包纳入捕获，未定。
- **病态深链是否需要硬上限。** 展开策略靠「只展开失败路径」加行数预算自限（见 [Display](display.md#展开策略与预算)），没有固定深度上限。

## 相关阅读

- [CLI](cli.md) —— `show --source` 的终端形态、省略规则与两个展开入口。
- [Display](display.md) —— 归属、建树、裁行三阶段装配算法，展开预算与链不完整时的降级。
- [Architecture](architecture.md) —— `loc` 调用链、捕获规则、递归数据模型与 web 面投影。
- [`--source` 当前契约](../../feature/reports/show/eval-source.md) —— 被本设计替换的单文件形态。
- [Attempt 详情组件](../../feature/reports/components/attempt-detail/README.md) —— `AttemptSource` 的组件位置与视觉规范。
- [Results · `sources.json`](../../feature/results/architecture.md#sourcesjson) —— 源码落盘的引用 + 去重仓库两层结构。
