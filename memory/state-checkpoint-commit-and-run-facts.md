---
relations:
  - role: supports
    target: docs/feature/state/architecture.md#存储
  - role: supports
    target: docs/feature/experiments/data-model.md#归属与实体
---
# State 提交必须同时保存状态指针与可审计事实

文件 HEAD 的原子 rename 与 SQLite 中 Run 回执是两个提交点。即使全过程持有独占租约，进程仍可能在 HEAD 生效后、回执提交前终止。
重启后的运行会消费新状态，历史 Run 却无法证明保存发生；给 rename 加一次读取比较也不能变成跨存储原子提交。
把 checkpoint 内容、指针和保存事实放进同一 ProjectDatabase，使最后一步只剩一笔可精确重读的事务，能消除这个窗口。
内容摘要用于校验字节，独立 checkpointId 用于比较提交身份，避免相同内容的 ABA。

多个 State 全取租约还需要持久化集合。仅在实例创建后保存 leaseSetId，会遗漏“锁已提交、实例尚未创建”的崩溃窗口。
先原子创建全部 Run，再让各 Experiment 独立取得集合；集合与所有 key 同事务落盘并绑定 exact runId，先于 Hook 和 Provider。
不能让已持有集合的 Experiment 等待其它集合才开始执行，否则交叉 key 会形成启动死锁。恢复从 exact key/token 找回原集合，不按当前配置或相同 PID 拼装成员。
Run recovery 终结执行事实，集合 recovery 处理补偿与释放；两个入口共享既定顺序，不能各自向终态 Run 追加事实。

这些约束属于设计理由，不能代替真实文件操作、崩溃恢复与公开 query 的实现验收。完整行为由关联契约唯一拥有。
