# 弄清一条结果为什么是这个判定

## 用户目标

评估作者看到一条 Attempt 是 `passed` 却只有一半的分，或者是 `failed` 却大部分条目都满足。
他想知道哪一条断言决定了判定，哪些只影响分数，哪些只是留作观察。

## 起始状态

项目里有一次已发布的 Run，用户手上有那条 Attempt 的 locator。本篇是预期用法，输出均为预期结果。

## 完整路径

1. 打开断言明细。 {#open}

   ```sh
   niceeval show @1TE2JP6T4SHNX assertions
   ```

   ```text
   Assertions @1TE2JP6T4SHNX
     Verdict passed · Score 34/72
     Gates 3 pass · Scored 28 · Notes 4 met, 2 unmet

     GATE  pass     install.gate.version · 安装了指定的候选版本
     SCORE 0/2      install.first-turn.protocol · 核对接入协议
     SCORE 3/3      install.layout.owner · 安装融入宿主工具链
     NOTE  unmet    install.gate.current-attempts · 当前格包含 Attempt
     ……
   ```

   预期结果：第一行给出判定与得分，第二行按作用计数。三个 `GATE` 都是 `pass`，所以判定是 `passed`。

2. 按标记读每一条。 {#read}

   | 看到 | 含义 |
   |---|---|
   | `GATE fail` | 这一条让判定变成 `failed` |
   | `SCORE 0/2` | 丢了两分，不影响判定 |
   | `NOTE unmet` | 条件没满足，既不影响判定也不影响分数 |

   预期结果：读者不需要打开评估源码，就能说出判定由哪几条决定。
   标签里写着 `gate` 字样的条目如果标记是 `NOTE`，说明作者只用它提前停止，没有把它声明成质量门。

3. 下钻到丢分最多的一条。 {#drill}

   ```sh
   niceeval show @1TE2JP6T4SHNX ae_<id> --full
   ```

   预期结果：这一条的判据、材料、裁判给出的理由与证据。条目标题使用与列表相同的标记。

## 结果

用户能用一句话说明这条结果：“三个质量门都过了，丢的 38 分来自这几条计分项。”
验收失败的情形：零分的计分项显示为通过；只控制流程的条件显示成失败的质量门。

| 情形 | 用户看到的结果与下一步 |
|---|---|
| 某个质量门是 `GATE unavailable` | 判定是 `errored`；先让这条质量门读得到证据，再谈得分 |
| 计分项显示 `?/3` | 这一项无法计算，得分完整度不是 `complete` |
| 想让一个 `NOTE` 影响判定 | 在评估里给它加上 `.gate()`，这是作者的决定 |

## 相关契约

- [Inspection CLI](../cli.md#attempt-断言详情示例)：标记与计数行。
- [Score Eval](../../assertions/library/score-points.md)：gate、score 与判定的关系。
