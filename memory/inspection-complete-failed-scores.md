# 现象与边界

消费者在公开 run.summary 与 attempt.get 读到 failed 且 score.state=complete 的评分，Insight 总分与完整性却忽略这些结果；完整的零分也显示不可用。失败判定与评分完整性须分别保留。

## 已核对的根因

inspection/overview.ts 的 scoreForCell 使用 verdict === passed 作为完整评分样本条件，scoreForMember 则保留 failed 的完整分数。普通总分与完整性因此相互矛盾。成功排名标签不是分数可用性的判据。

## 验收

通过公开安装候选的 Inspection 与 Insight 读取 failed+complete 的非零及零分，核对同一分母、总分及完整性；partial/unavailable 不补零，verdict 不改写。正式红绿与可靠性证据取得前保持开放。
