# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md)

## 定案

采纳 [PLAN-2：owner-local typed links 与动态编译](PLAN-2/README.md)。正式目标写入[仓库文档追溯工程契约](../../engineering/docs-traceability/README.md)。

## 依据

PLAN-2 保留现有 ownership：产品语义归 Feature，测试组合身份归 Engineering owner anchor，测试动作归原生 test/spec，历史证据归 Memory。
它只给这些 owner 增加可机器辨认的正向指针，反向列表每次编译，不签入中央 graph。

同一原则延伸到用户场景 provenance：原始观察及 adoption 归 Feedback，调查/裁决及 promotion 归 Memory，测试回归与 Issue header 归 test/spec。
Feature/Use Case 不回写 Feedback、Memory 或 Issue 列表，也不增加 sidecar JSON。README、Library、CLI、Architecture 等页面角色由 package placement 派生；formatter 只消费 Snapshot，不进入 metadata。

path-derived identity 与现有目录生命周期一致。Roadmap 采用会替换身份，因此由受锁 `adopt` 显式重写强关系与 promotion history，而不是增加永久 ID 或 alias。

固定的 kind-specific 投影足以回答 Feature 和测试查询。公开命令按用户正在操作的对象命名，底层仍只编译一份 Snapshot。
拒绝任意 traversal 可以避免工具逐步演变成测试完整度平台或第二套产品模型。

## 为什么保留两跳 E2E owner

最终链路是：

```text
test/spec ──owner──► engineering/testing owner anchor ──contract──► Feature / leaf Use Case
         └─regression──► Memory
```

较新的 testing 契约明确区分产品契约与测试组合 owner。把 78 个 owner 全改成直指 Feature 会混合两种所有权，并迫使 Feature 增加测试导向 anchor。

owner anchor 不是 Behavior 或 Proof 节点。它只保存稳定结果身份与唯一 contract pointer；lane 来自 Repo metadata，argv、expected、步骤、fixture 和标题仍在测试文件。

## 否决 PLAN-1

[中央 Registry](PLAN-1/README.md)把路径、测试头、Memory 和索引已有的事实再抄一遍。每次结构变更都要同步中央文件，并让并行 Agent 争写同一位置。

Registry 还会自然吸收 coverage、状态与反向列表，最终成为 Feature 和 testing 文档之外的第二真源。查询方便不足以抵偿这种长期漂移。

## 采用边界

- 5 个直接 Feature owner 规范化为 Engineering owner anchor；其余 78 个 owner 身份保持不变。
- 每个 owner anchor 增加唯一、版本化、紧邻的 contract link；Feature 不保存反向测试列表。
- 所有文档节点按 placement 补 frontmatter；普通分组、category README 与 reference 不升级为节点。
- strict check 切换时一次性清除自由文本 regression，不保留 doc-node legacy reader；Memory legacy reader 保留。
- Design 写作规则改用 `selectedPlan` 作为机器真源；标题中的“推荐”只供人读。
- 所有 Trace-visible owner publication 都先写 Git-private recovery journal；journal 保护提交与崩溃恢复，不成为关系 Registry，也不声称全仓瞬时原子写入。
- Feedback 与 Memory 的关系 mutation 共用 shared/read、exclusive/write advisory lease、两次稳定输入捕获、preimage 与 generation；current/history 只能由具名命令维护。
- generation durable replace 是唯一 commit point。恢复只在 owner、HEAD、Git index、mode、worktree identity 与 journal 全部匹配时自动回滚；未知状态保留 owner 与 journal并失败。

## 复审触发条件

只有固定 Feature/Test 投影无法回答至少两个稳定维护任务，且新增闭包仍能明确停止边界时，才扩展命令。
出现这类证据也先增加具名投影，不直接引入通用图查询或持久 Registry。
