# PLAN-1：每题重新 clone

每道 Eval 的 prepare 删除旧 `.git`，从 GitHub clone repository，再 reset 到自己的 base commit。

优点是写法直接，每题可以自行删除多余 refs 与 objects。
缺点是同一复用 Sandbox 没有复用下载；题目越多，流量与准备时间越接近题数的线性倍数。

该方案不能满足“同一 repository 只下载一次”的主要目标，因此否决。
