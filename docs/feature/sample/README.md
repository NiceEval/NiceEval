# Sample —— 选出一份可比较的样本

[Record](../record/README.md) 回答「盘上有什么」。要拿这些记录说一句「现在什么水平」,中间还差
一步:**从全部历史里选出一批 attempt,并如实交代这批数据代表性如何**。这一步就是 Sample。

```typescript
import { openRecord } from "niceeval/record";
import { currentSample } from "niceeval/sample";

const record = await openRecord(".niceeval");
const sample = currentSample(record, { experiments: "compare/" });

sample.attempts;    // 按口径挑好的 attempt 全集 —— 消费这个就自动正确
sample.coverage;    // 这批数据覆盖了多少题,缺哪几道
sample.warnings;    // 这批数据哪里可能不可靠
```

## 为什么是独立的一层

选择是**看法**,不是事实。「每个实验取最新一次」是一种选法,「这批数据缺了三道题」是一次推断——
它们都需要判断,而 Record 的承诺是每个返回值都能在磁盘上逐字节指出来源。把选择器长在 Record 上,
那个承诺当场就有一半不成立,读者每读一个字段都要先想「这算事实还是算解释」。

分层之后三条线各自干净:Record 无判断,Sample 有口径、覆盖与时效的判断,Reports 有指标、折叠与
排版的判断。三层的分工、跨层不变量与「一件事该放哪层」的判据见[Reading](../reading/README.md);
这个切法学自 Vega-Lite 的 `data → transform → mark`,理由见[参考方案](reference/README.md)。

## 一份 Sample 上有什么

**口径是物化的数据,不是隐藏语义。** `mode` 写出基础选择方式,`fresh` 写出是否只含新执行。
`attempts` 是按完整口径挑好的全集——自定义脚本消费它就自动正确,不需要知道口径怎么展开,也不会
因为自己 `flatMap` 一遍 `runs` 而把同一道题的历史 attempt 重复计入。

覆盖与警告跟着样本走,不散在别处:一份 Sample 交给谁,「这批数据缺什么、哪里不可靠」就跟到谁手上。
[`publish()`](../record/library.md#发布publish) 与 Reports 的全部计算函数都收
`Sample | readonly Run[]`。

## 常见用途

| 用途 | API |
|---|---|
| 看每个实验最近一次跑出了什么 | `latestRunSample(record)` |
| 看每道题当前的判定水位 | `currentSample(record)` |
| 只看最新一次真实执行的 | 任一选择器 + `{ fresh: true }` |
| 排掉一个已知坏掉的实验 | `sample.pipe(dropExperiments(…))` |
| 按自己的条件删减样本 | `sample.pipe(filterAttempts(…))` |
| 发布这批数据 | `publish(sample, dir)` |

**这一层只删减,不聚合。** 「按 agent 分组算 p90 耗时」不在这里——值怎么算、两级怎么折叠由
[Reports 的指标](../reports/library/measures.md)回答,它已经有 `perEval` / `acrossEvals` 两级
聚合与维度选轴。同一件事有两个地方能做,两边迟早给出不同的数。

## 相关阅读

- [Library](library.md) —— 选择器、Sample 形状、转换算子与警告全集。
- [参考方案](reference/README.md) —— 转换算子与口径物化从哪里学。
- [用例手册](use-case/README.md) —— 按实际读取任务选择 API。
- [Record](../record/README.md) —— 被选择的那份事实。
- [Reports](../reports/README.md) —— 建立在样本之上的指标与组件。
