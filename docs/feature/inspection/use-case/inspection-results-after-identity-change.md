# 配置变了以后，仍然看得到上一次的成绩

## 用户目标

评估作者升级了 Agent 版本或被测版本，再看总览时全部位置都成了缺口。
他想在决定是否重跑之前，先看到上一次的成绩和这次到底变了什么。

## 起始状态

项目有一批已发布的结果。之后某个进入身份的输入变了，当前目标的每个位置都不再匹配旧结果。
本篇是预期用法，输出均为预期结果。

## 完整路径

1. 看总览。 {#overview}

   ```sh
   niceeval show
   ```

   ```text
   Current results
     Covered    0/24
     Gaps       24

   Reference results (from previous recorded attempts)
     Previous attempts  24 of 24 gaps
     Verdicts           21 passed; 3 failed; 0 errored; 0 skipped
     Score              612/768
     Notice             Prior configuration; rerun required to update target
   ```

   预期结果：当前结果如实显示为缺口，旧结果不计入当前分数；参照区给出上一次的判定分布与得分。

2. 看每个缺口对应的旧结果。 {#gaps}

   ```text
   Attempts · harness/canary
     Changed  config:agentInstalls (codex 0.144.1 → codex 0.167.2) · all 6 gaps

     Eval tool-guard
     Gap identity-mismatch
     Previous result @1SXQTBZCQCNV7 (passed, 21/21)
   ```

   预期结果：同一条 `show` 已经写出变的是哪一项；全部缺口原因相同时只写一次。
   每条缺口下面有一行 `Previous result`，可以直接复制 locator 下钻。

3. 看重跑的规模。 {#dry}

   ```sh
   niceeval exp harness/canary --dry
   ```

   预期结果：逐个位置列出将要执行还是沿用，以及完整的变化列表。这条命令不创建任何资源，也不花钱。

4. 决定范围。 {#decide}

   预期结果：变化确实影响执行时，按需要重跑；变化不影响已有证据且属于可采用的情形时，用 `niceeval accept`。
   两条路都由用户决定，NiceEval 不替用户把旧结果算成当前结果。

## 结果

用户在重跑之前已经知道上一次的成绩、这次变的是哪一项，以及重跑的规模（[T-13](../../../taste.md#t-13)、[T-31](../../../taste.md#t-31)）。
验收失败的情形：总览只显示 `0 passed`，让人以为项目从未成功运行；缺口只写身份不匹配，要另跑一条命令才知道是哪一项。

| 情形 | 用户看到的结果与下一步 |
|---|---|
| 只有一部分缺口有旧结果 | 参照区写 `Previous attempts 8 of 24 gaps`，其余位置从未运行 |
| 旧结果缺少身份清单 | 说明行写 `Unexplained` 与原因；`--dry` 列出仍能确定的变化 |
| 只想看参照结果 | `niceeval show --reference` |

## 相关契约

- [Inspection CLI](../cli.md#全缺口与参照结果示例)：参照区的内容。
- [Experiments · Cache](../../experiments/architecture/cache.md)：哪些输入进入身份，哪些情形可以采用。
