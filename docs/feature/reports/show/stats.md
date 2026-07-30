# `--stats`：eval × experiment 稳定性矩阵

「哪几道题从来没通过过」是判断题目质量的第一诊断：一道在所有条件、所有历史执行里零通过的题，先怀疑题目（prompt 缺公开契约、隐藏测试断言过强），再怀疑 agent。
`--stats` 把范围内每个 eval 摊成一行、每个 experiment 一组列，格内是该组合**全部历史执行**的判定计数——一条命令回答稳定性，不需要脚本遍历落盘文件。

`--stats` 调用公开 `stabilityResult(sample, options)`。
范围内的 Experiment 是比较列，eval 前缀决定题集；任务函数返回普通 Result，text 组件与 ShowJson 消费同一次结果。

## 口径

- 证据面与 [`--history`](history.md) 相同：跨 Run 按 [attempt 身份键](../../record/library.md#身份键与去重)去重后的历次执行，不设可比性门槛——旧配置下的执行也计入。
  它回答「这道题曾经怎样」，不是默认报告的现刻水位；两个口径的分工同 history 篇。
- `--fresh` 照常收窄（只统计新执行）；eval 前缀与 `--exp` 照常收窄行与列。
  `--stats` 与 `--history` 是同一份事实的两个投影：矩阵行是时间轴节的聚合，从矩阵格下钻用 `<eval 前缀> --history` 摊开逐次执行。

## 输出

```sh
$ niceeval show --stats
稳定性 · 30 个 eval × 3 个 experiment · 全部历史执行 · ✗ 判定失败 / ! 执行错误分列

eval                                  baseline        mempal          nowledge
react-datepicker/pr-6058   never ✓    ✓0 ✗3 !0        ✓0 ✗2 !1        ✓0 ✗3 !0
react-tooltip/pr-1269      never ✓    ✓0 ✗2 !1        ✓0 ✗3 !0        ✓0 ✗3 !0
lightbox/pr-482            never ✓    ✓0 ✗3 !0        ✓0 ✗3 !0        ✓0 ✗2 !1
rhf/pr-13594                          ✓1 ✗2 !0        ✓2 ✗1 !0        ✓1 ✗1 !1
memory/agent-037-updatetag-cache      ✓3 ✗0 !0        ✓3 ✗0 !0        ✓2 ✗0 !1
downshift/pr-1502                     ✓2 ✗0 !1        —               ✓1 ✗0 !5
…

汇总                                  ✓48 ✗22 !2      ✓55 ✗17 !0      ✓41 ✗19 !12
```

聚合口径——行序、`never ✓` 判定、格内三计数固定顺序与分列理由、汇总行——单源在 `stabilityResult()`；本页只保留 CLI 呈现行为与示例。
终端宽内容照常横向滚动，不合并列。

## 边界

- 与 `--report` 互斥（零配置装配，不经用户显式报告树）；与 `@<locator>` 组合是用法错误——单 attempt 没有稳定性可言。
- 要看某一格的逐次执行与失败原因，下钻 `niceeval show <eval 前缀> --history`；要看现刻水位对比，用[对照矩阵](compare.md)。
- 发布用的可靠性报告可以复用 `stabilityResult()`，并排 `passRate` / `taskPassRate` / `executionReliability` 归因损失来源； `--stats` 服务终端里的即时诊断。

## 相关阅读

- [计算边界](../calculations.md#stability-不是内核) ——稳定性公式为什么不进入公共内核。
- [`--history`](history.md) ——同一证据面的逐次执行时间轴。
- [对照矩阵](compare.md) ——现刻水位的逐题对照。
- [`--json`](json.md) ——信封与逐视图指针。
