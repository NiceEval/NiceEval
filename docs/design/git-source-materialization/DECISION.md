**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Limits](LIMITS.md) · [Cases](CASES.md)

# Decision

## 定案

采用 [PLAN-4：SourcePool 与 SourceProjection](PLAN-4/README.md)。
公开作者面只保留 `checkout({ repository, commit, into? })`，缓存与传输没有作者开关。

宿主用 SourcePool 保存可增长的 acquisition 状态。
每个 commit 另行发布只含该 commit 完整祖先闭包的不可变 SourceProjection，Sandbox 只能取得后者。

## 依据

PLAN-4 是唯一同时满足对象级隔离、增量获取、每 Attempt 全新 Git metadata 与独立 GC 的候选。
SourcePool 和 SourceProjection 分开后，pool 可以增长或回收，而已经发布的投影身份与内容不变。

Demand 在 planning 时可求，Resource Identity 在构建后补齐 object-set digest、pack digest、对象数与字节数。
这避免用尚未产生的输出 digest 做 lookup key，也避免把 pack 压缩字节的偶然差异误认为两个用户需求。

## 否决项

- [PLAN-1](PLAN-1/README.md) 把完整未来历史放进 Agent 可读的 Sandbox，且按不同 commit 重复 mirror，不能通过 C1 至 C3。
- [PLAN-2](PLAN-2/README.md) 让题目对象库间接读取共享对象，知道 OID 即可越过 ref 隔离，不能通过 C2。
- [PLAN-3](PLAN-3/README.md) 用一个实体同时表达可增长 acquisition 状态与不可变发布物，无法保持 immutable entry、lease 和 GC 不变量。

## 遗留风险

超大型 repository 可能耗尽宿主或 Sandbox 空间。
Roadmap 必须为对象数、投影字节、scratch 空间与准备时间给出 fail-closed 上限，并让运行事实报告实际使用量。

private repository 需要稳定的非秘密授权分区身份和撤权语义。
在该模型单独定稿前，private、SSH 与凭据查找函数不进入支持面。
