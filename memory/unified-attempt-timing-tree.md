# 设计裁决:`--timing` 统一 phase/hook/command/turn/OTel 时间树

**裁决**(2026-07-14,用户继续挑战「只展开 setup hook、看不到 hook 内真实 shell」「OTel 时间只在 execution」的诊断断层):

1. `PhaseTiming.steps` 的一层 `{label,durationMs}` 改为递归 `children: TimingNode[]`。runner 时间树表达 lifecycle phase → hook / turn → command；节点带 `startOffsetMs`,允许恢复并发 sibling 的重叠,不能把 children 简单求和。
2. Sandbox 创建成功后由 core 统一包装中性 `Sandbox.runCommand()` / `runShell()`。`sandbox.setup`、workspace baseline、`eval.setup`、`agent.setup`、telemetry configure、`eval.run`、workspace diff 与收尾阶段发出的公开 shell 都自动挂到当前 timing context；provider 内部方法转调只记最外层一次。此前「agent.setup 内部 runner 看不见、不能细分」的裁决被推翻——runner 不需要理解 adapter 业务步骤,只需观察它经过中性 Sandbox 边界的命令。
3. 每次 send 由 runner 记录结构化 turn 包络(`sessionIndex` / `turnIndex` / `turnId` / duration)。有 OTel 时保存 `traceId` 与 attribution,消费方从 `trace.json` 临时把 agent/model/tool spans 挂到 turn 下；没有 OTel 时 turn 总耗时仍可用。
4. `show --timing` 成为整个 Attempt 的统一时间入口；`show --execution` 仍以事件为骨架,唯一关联上的 OTel 时间只作为事件旁注。两个视图可投影同一个 span,不复制或改写 artifact。
5. Runner duration 使用单调时钟,`startedAt` 继续用 ISO 墙钟。命令只保存有界脱敏 display、状态与 exit code；env value、stdout/stderr 与完整长脚本不进时间树。
6. `sandbox.create` 发生在 Sandbox 对象存在之前。内置 provider 可主动报告真实 SDK/宿主步骤；第三方 provider 没细分时只显示阶段合计,不伪造 shell。
7. Effect Scope release 完成后才封口 Attempt。`sandbox.stop` 等 finalizer 写入共用 timing recorder；不能让 body 先构造最终结果而丢失 stop 时间或 diagnostic。

**密度裁决补充**(2026-07-15,真实 `workspace.diff` 时间树出现 3,300 余条逐文件 `git show` / `cat-file`):

8. `show --timing` 仍是统一时间入口,但裸 flag 不再承诺无界逐节点展开:它完整列 phase,detail node 使用 80-node 预算,按失败路径 / 最慢路径 / 首尾时序稳定取样并显式报告 omission;`--timing=full` 才逐节点展开完整 runner tree 与已关联 OTel spans。TTY / pipe / CI 使用相同投影,不自动启动 pager。
9. 大树先修 producer 的执行边界,不能只修 renderer。内建批量工作用 `operation` 记录采集端已知的逻辑语义与规模,实际公开 Sandbox command 挂在下面;provider 往返按逻辑批次有界。renderer 不解析 shell 文本猜 `git show ×N`,也不接受 artifact 自带 render callback。旧 artifact 的逐文件调用由默认有界摘要止住终端洪水,full 模式继续保留原始性能证据。

**改写的旧裁决**:

- `phase-timings-teardown-steps-and-show-view` 中「step 级只逐 hook / send」与「agent.setup 不细分」被本裁决替换；phase 级稳定聚合、收尾独立计时与 show/view 消费面继续保留。
- `show.md` 中「timing 只回答 runner 环境与调度、execution 回答 agent 内部耗时」被替换为「timing 统一分析,execution 保留上下文时间注释」。
- 本条 2026-07-14 版本中「完整时间入口」若被理解成「裸 `--timing` 无界逐节点展开」,由 2026-07-15 密度裁决替换为「统一入口 + 默认有界诊断投影 + 显式 full」。完整 artifact 与 full 读取能力保留。

**理由**:

- hook 名只能定位到一段用户代码,不能回答慢在其中哪条安装/恢复命令；所有内置与自定义 adapter 已共享 Sandbox 命令边界,core 可以中性观察而不理解 provider 或 agent 名字。
- turn 墙钟包络与 OTel 解决不同问题:前者覆盖 adapter/CLI/IPC/未埋点空白,后者解释模型与工具内部；二选一都会留下盲区。
- 扁平 step 无法表达 hook→command 与 turn→CLI→OTel 的包含关系,并发时还会诱导错误求和。
- 自动 pager 会让 coding agent / CI 的非交互消费阻塞;按 command 文本聚类又会掩盖真实的 O(files) provider 往返。采集端 operation + renderer 固定预算同时保留语义、性能证据与终端可读性。

**How to apply**:契约落点为 `docs/feature/results/architecture.md`、`docs/feature/reports/show.md`、`docs/feature/reports/view.md`、`docs/feature/sandbox/architecture.md`、`docs/observability.md` 与 `docs/engineering/benchmark/README.md`。实现计划见 `plan/sandbox-phase-timing-surfacing.md`。
