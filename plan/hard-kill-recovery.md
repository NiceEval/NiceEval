# PLAN：强杀（SIGKILL / 外部看门狗）后的三面恢复——孤儿核对、实验收尾兜底、attempt 级续跑

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；每个阶段先满足自己的验收条件，再进入下一阶段。
>
> 来源：2026-07-21 真实事故——外部看门狗（后台任务 ~1h 硬寿命上限）反复强杀 2.5h 的串行 eval run：实验级 teardown（`nowledge-mem.sh down`，持有 license 席位的外部记忆服务）从未执行、随重跑累积泄漏；Docker 孤儿容器只能手工清；已完成的 attempt 结果无法续用。进程内三级响应（`docs/cli.md`）覆盖不到 SIGKILL，旧契约只说「label / TTL 留作事后核对」但没有任何机器动作。事故台账：`memory/hard-kill-leaves-orphans-and-experiment-leaks.md`。
>
> 范围：①沙箱创建期写运行标识元数据 + `niceeval sandbox list --orphans` / `sandbox prune`；②实验收尾登记 `.niceeval/teardowns/` + `niceeval exp` 启动自愈 + `--teardown` flag；③携带（carry）细化为 attempt 粒度、未收尾快照参与携带。不做：拦截 SIGKILL（不可能）、vercel 孤儿核对（无元数据检索通道，TTL 兜底）、自定义 provider 的孤儿核对（不执行用户代码的既有边界）、attempt 级钩子的跨进程重放（会双跑，见 docs/cli.md 三级响应）。

## 开始前必读

1. `CLAUDE.md`：仓库总规则，特别是「先文档后代码」、同步义务表、禁止 feature branch。
2. `docs/feature/sandbox/architecture.md`「孤儿核对:强杀路径的实例面兜底」：运行标识三字段、三条「与」的孤儿判定、偏保守纪律（unverified 不自动杀）。
3. `docs/feature/sandbox/cli.md`「`sandbox list --orphans`」「`sandbox prune`」：输出示例即验收样式；残留提醒的孤儿行（docker 零成本核对，云不在启动期探测）。
4. `docs/feature/experiments/architecture.md`「强杀后的收尾兜底:收尾登记与启动自愈」：登记时点与形状、启动自愈裁决表（同宿主 pid 死 → 自愈/提醒；否则不触碰）、删登记互斥、`--teardown` 语义。
5. `docs/runner.md`「缓存:指纹去重」：attempt 粒度携带、未收尾快照参与携带、与 earlyExit 的组合。
6. `docs/cli.md`「中断:三级响应」末段：SIGKILL 兜底的两个事后入口；实验级注册表段的磁盘持久化一句。
7. 登记表新行：`docs/engineering/unit-tests/sandbox/cases.md`「孤儿核对与 prune」、`docs/engineering/unit-tests/experiments-runner/cases.md` 实验级生命周期新增 4 行 + 缓存分区新增 2 行——测试只为这些行而写。
8. memory：`force-exit-skips-experiment-teardown`（进程内注册表与 settle 语义，别破坏）、`e2b-provision-429-duplicate-sandbox`（e2b metadata 通道已用于 provision token，运行标识同通道追加）、`vercel-sandbox-issues`（session 寿命短，expiresAt 照实算）。
9. 当前实现入口：`src/sandbox/docker.ts` / `e2b.ts`（创建参数、label/metadata）、`src/sandbox/registry.ts`（逐条目文件纪律，孤儿核对与收尾登记复用同一套原子写）、`src/cli.ts`（sandbox 命令组分派、`FLAG_OPTIONS`）、`src/runner/experiment-cleanup-registry.ts`（触发时点、settle 点——磁盘登记挂同一时点）、`src/runner/fingerprint.ts` + `planCarry`（携带规划）。

## 阶段 1：运行标识与孤儿核对（实例面）

- 创建期为 docker 容器追加 label、e2b 实例追加 metadata：`host`（宿主机名）、`pid`、`startedAt`（快照时刻）。与既有 `niceeval.keep-candidate` / provision token 同机制同通道；vercel 不写、不报错。
- `sandbox list --orphans`：docker 按 label 查本地 daemon，e2b 按 metadata 过滤 SDK 实例列表；排除留存注册表已登记条目；同宿主 pid 探测（`process.kill(pid, 0)` 语义）裁决 `orphan` / `unverified`；输出样式照 `docs/feature/sandbox/cli.md`。只读。
- `sandbox prune`：销毁 `orphan`（docker `rm -f`、e2b SDK kill），`--force` 含 `unverified`；幂等；单台失败列出并退出 1、其余照常。不触碰注册表条目。
- `niceeval exp` 启动残留提醒追加孤儿行：仅 docker 本地 daemon 零成本核对，云 provider 不探测。
- 验收：`docs/engineering/unit-tests/sandbox/cases.md`「孤儿核对与 prune」3 行全部变绿；`pnpm run typecheck`、`pnpm test` 通过；本机 docker 手测：起一个假 niceeval label 容器（pid 填已死进程）→ `list --orphans` 可见 → `prune` 收回。

## 阶段 2：实验收尾登记与启动自愈（实验面）

- 触发时点（`experiment-cleanup-registry.ts` 登记进程内条目的同一处）先原子写 `.niceeval/teardowns/<entry>.json`（复用 registry.ts 的 temp → fsync → rename 纪律）：`{ experimentId, experimentFile, selectedEvalIds, pid, host, startedAt }`；teardown settle 后删除（所有触发路径）。
- `niceeval exp` 启动扫描：同宿主且 pid 死 → 选中实验先补执行 teardown（新进程语义：闭包未赋值，ctx.selectedEvalIds 取自登记，反馈行标注 recovery）再 setup；未选中打提醒行给出 `--teardown` 命令；pid 活/异宿主不触碰。补执行前先原子删登记，删除成功者才执行（互斥）；失败记 `experiment-teardown-failed` 不自动重试。
- `--teardown` 进 `FLAG_OPTIONS`（写 JSDoc，缺注释生成器报错）：只对选中实验各执行一次 teardown，不派发 attempt、不跑 setup，无登记也执行；抛错退出 1；与 eval 前缀组合报用法错误。
- 验收：`experiments-runner/cases.md` 实验级生命周期新增 4 行变绿；真实冒烟：在 `/Users/ctrdh/Code/coding-agent-memory-evals` 里 `kill -9` 一个带实验 setup 的 run，重跑确认 teardown 先补执行、`.niceeval/teardowns/` 清空。

## 阶段 3：attempt 粒度携带（续跑）

- `planCarry` 细化：指纹未变时逐条携带上一轮终态 attempt，只派发缺失序号；分母 = 携带 + 新跑；携入 passed + earlyExit 开 → 缺失序号不派发、计入 `earlyExitUnstarted`。
- 携带来源接受未收尾快照（缺 `completedAt`）：已落盘终态 attempt 照常携带；errored / skipped 照旧不携带。
- reused 计数、dashboard/envelope 的携入展示与真实调度共用同一次 planCarry 判断（既有约束，别拆开）。
- 验收：`experiments-runner/cases.md` 缓存分区新增 2 行变绿；真实冒烟：runs 5 跑到 3 次时 `kill -9`，重跑确认只派发 2 次、汇总通过率分母为 5。

## 收尾同步义务

- `FLAG_OPTIONS` 新项（`--teardown`；`sandbox` 命令组的 `--orphans` / `prune` / `--force` 视实现位置）JSDoc → `pnpm docs:reference` 重新生成参考页区块；核对 `src/i18n/` 两份 `--help` 速查是否需要点名（手工体裁，按现有取舍）。
- grep `docs/` 与 `docs-site/` 确认行为与契约一致（本 PLAN 对应契约已先行落稿：`docs/feature/sandbox/architecture.md`、`docs/feature/sandbox/cli.md`、`docs/feature/experiments/architecture.md`、`docs/feature/experiments/cli.md`、`docs/runner.md`、`docs/cli.md`、`docs-site/zh/troubleshooting/recover-after-kill.mdx`）。
- 实现中的翻案或反直觉修法记 memory 并索引。
