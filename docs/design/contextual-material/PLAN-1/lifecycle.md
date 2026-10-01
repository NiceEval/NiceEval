# 上下文材料 Match —— Lifecycle

| 阶段 | Framework | 应用 |
|---|---|---|
| 声明 | 校验并保存 reader 与 predicate，不取 ctx | 构造可复用材料 Match |
| Attempt 创建 | 创建独立 runtime、用量账本、墙钟与 facade | create 返回当前应用上下文 |
| 调用断言 | 校验开放状态，注入接收者 ctx，复制完整事实一次 | 同步只读取数 |
| 登记 | 保存稳定身份、原文、顺序与定义 | 使用 gate/score 设置断言 |

| Seal | 同一 evaluator 执行 predicate，完整非空集合调用受管 Judge | 无自行匹配或模型调用 |
| Cancel | 关闭读取和进度，取消模型，固定终态收据 | 按已有 cleanup 执行资源释放 |
| 结束 | 清除 receiver/ctx 引用，保留正式断言审计 | ctx 不再对评估代码开放 |

每个 Attempt 创建一次上下文；每个材料断言读取一次；每次读取 usage 创建一个不可变切面。
声明跨 Attempt 复用，ctx 与已选材料跨 Attempt 不复用。
Agent turn 和 session facade 的材料读法绑定自己的接收者，不借用 root 的另一范围。

错误参数、伪品牌与重入读取在登记处抛出作者错误。模型与证据不可判定形成 unavailable，不能伪造零分。
Reader 抛错保留 producer 失败，取消后不重新读取。
本契约无镜像构建、sandbox 复用或消费者自动安装阶段；沿用所选 Adapter 的资源生命周期。

## 开放与取消的顺序

Create 开始前 runtime 和统计 owner 已创建，但 application receiver 尚未开放。
Create 正常返回后检查当前 Attempt 仍开放，再创建 guarded app 与材料 receiver。
Assertions factory 只组装同步方法；此时 app 访问和材料读取仍被 guard 拒绝。
成功验证方法后一次开放 app/receiver，再组装返回 Eval facade，开始作者 test。

Factory 抛错时关闭刚创建的 receiver；无任何绑定表待回滚。

取消先关闭作者登记和所有 receiver，再中止托管模型。Cleanup 使用原有独立释放阶段。
Create 在取消后迟到返回时，按原 Adapter cleanup 义务释放资源，不组装 Eval facade，不开放 reader。
Agent receiver 同样只在自身 facade 就绪后开放，并在所属 Attempt 取消后统一关闭。

集合与单事实 reader 共用这个生命周期。单事实评分只执行一次已有 ScoreMatch，不按事实内数组再次分派。
Reader 前的预算预留在 reader 抛错、取消或登记失败时退还；成功登记才将实际内容和审计预留归属断言。
尚未登记的临时捕获不留在 runtime 总量中，已封存完整内容继续由正式 Attachment 拥有。

## Agent 默认历史与封存

每次实际 send 的正式观察段在成功、失败和中断路径封存，并保存其 outcome 与证据完整性。
失败没有可信 Turn 时不补 complete，也不从默认材料中丢弃已经写入的事件。
Receiver 先固定 cut，再读取该 cut 内的全部 sealed 事实；同 Session 的工具关联先于当前 Turn 的事件选择。
在 readContext 之前保存的私有 cut frame 只属于本次调用，不能被另一个 receiver 的方法复用。

关闭统一移除 ctx/cut/default-reader 回调；随后释放正式观察的临时 evaluation 材料。
Question-only 与领域简写均归一化到同一 check 和材料问答 Match，捕获完成后只持有不可变证据。
