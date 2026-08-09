# 局部补跑之后，固定样本怎样形成

## 解决什么问题

一次 Experiment 可以只重新执行部分 Eval。
读者仍需要一份明确的总体：每个成员来自哪个 origin Run，当前 Run 为什么采用它，以及这条解释固定在哪个 source Graph。

## 场景

Experiment `baseline` 有 Eval `a` 与 `b`。
三个 Run 的 membership revision 如下：

| Run revision | `a` slot | `b` slot |
|---|---|---|
| `R1` | `executed(A1)` | `executed(B1)` |
| `R2` | `executed(A2)` | `carried(B1)` |
| `R3` | `executed(A3)` | `accepted(B1)` |

`A1`、`A2`、`A3` 与 `B1` 各自仍属于它们的 origin Run。
`R2` 和 `R3` 只在自己的 slot 中采用已有 Attempt。

## 全流程

1. 打开产生 `R3` current revision 的固定 `RecordGraphRef`。
2. 调用 `materializeSample(record, { runs: ["R3"] })`；函数对 runId 做 exact match，从这个固定
   handle 读取，生成值仍只保存 `record.ref`。
3. 选择器沿 `R3` revision 的强边读取两个 slot。
   它得到 `A3` 和 `B1`，并把 `executed` 与 `accepted` 的 contribution provenance 一并写进 Sample。
4. Sample 写入只含该 `RecordGraphRef` 的 `sources`、membership proof、完整分母和每个成员的 adopted NodeRef。
   之后 writer 即使产生 `R4`，这份 Sample 仍表示同一批 `A3` 与 `B1`。

如果 Run revision 的 durable `expectedMembershipSlots` 列出 `b`，但它没有 current contribution，
Sample 仍把 `b` 放进 denominator。指向该 Run 与 expected-slot selector 的 EvidenceRef 会证明
`unavailable / not-recorded`。

只有之后显式 `narrowSample()` 排除该 slot，输出才把它改为 excluded。materialize 不能自行二选一。
它不按时间回扫 `R1`，也不通过格式摘要猜哪条历史 Attempt 可替代。

## 边界

- contribution 是 Run 的 membership 事实，不会改变 Attempt 的 origin Run。
- 同一个 slot 的 adopted revision 只能严格线性推进；并列版本是 Record 输入错误。
- 选择使用固定 Graph 的 current strong edge，不使用目录扫描、时间排序或可变 head。
- 要看另一份历史组合，显式生成另一份 Sample；不要让同一份 Sample 漂移。
