# PLAN：`--keep-sandbox` 留存现场 + `niceeval sandbox list/stop` 完整生命周期

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；每个阶段先满足自己的验收条件，再进入下一阶段。
>
> 来源：2026-07-14 用户提出「跑完只停不销毁、方便进沙箱 debug」的需求；对话裁决为窄的 opt-in 留存设施（默认契约不动），并要求补齐事后停掉留存沙箱的命令行，构成完整生命周期。设计裁决出处：`memory/sandbox-keep-scene-decision.md`。
>
> 范围：`--keep-sandbox`（裸 = failed/errored，`=always` 全收）、留存注册表 `.niceeval/sandboxes.json`、`niceeval sandbox list` / `stop`、run 收尾 Kept sandboxes 输出与启动残留提醒、`result.json` 新增 `sandbox` 字段（provider / sandboxId / kept，沙箱型 attempt 无条件落盘）。不做：`Sandbox` 接口的 pause/detach 方法、留存沙箱的 resume/重评、`sandbox enter` 交互式子命令（打印 enter 命令即可）。

## 开始前必读

1. `CLAUDE.md`：仓库总规则，特别是「先文档后代码」、同步义务表、禁止 feature branch。
2. `docs/feature/sandbox/cli.md`：本功能的行为契约（flag 语义、命令输出示例即验收样式、错误反馈）。
3. `docs/feature/sandbox/architecture.md`「留存(keep)与注册表」：收尾链决策点、清理集合语义、注册表条目形状、各 provider 留存语义、`defineSandbox.stopDetached`。
4. `docs/cli.md`：命令分派新增 `sandbox`、可选值 flag 预扫（`--diff` 与 `--keep-sandbox` 同一机制）、「不留无主沙箱」不变量的新表述。
5. `docs/runner.md`「预热与复用」：keep 与跨 case 复用互斥、预热池不受影响。
6. `docs/feature/results/architecture.md`：`AttemptRecord.sandbox` 字段契约；`RESULTS_SCHEMA_VERSION` 相应升一格。
7. memory：`vercel-sandbox-issues`（Vercel session 寿命 ~360-390s，留存窗口极短，expiresAt 要照实算）、`e2b-sandbox`（e2b TTL 由模板/timeout 决定）、`provision-retry-holds-concurrency-slot`（改 attempt 收尾路径时别碰并发槽位语义）。
8. 当前实现入口：`src/cli.ts`（`FLAG_OPTIONS`、`--diff` 预扫、命令分派）、`src/runner/attempt.ts`（Scope finalizer / stopSandbox）、`src/sandbox/registry.ts` + `resolve.ts`（stopAllSandboxes、清理集合）、`src/sandbox/docker.ts` / `e2b.ts` / `vercel.ts`（创建参数与销毁）、`src/runner/feedback/`（run 收尾输出三种 profile）。

## 阶段 1：留存决策与注册表

- `--keep-sandbox` 进 `FLAG_OPTIONS`（布尔）+ 预扫 `=always`；把 `--diff` 的预扫推广成两项共用的可选值 flag 预扫，不再是单点特例。
- attempt 收尾：verdict 定稿后按策略判定留存；命中则跳过 `stop()`、把沙箱移出清理集合（`stopAllSandboxes` / Ctrl+C 三级路径 / Scope finalizer 都只清集合内），并写注册表条目（形状见 architecture 契约；`enter` / `expiresAt` 由 provider 给）。硬超时 `errored` 也要能留存；中断时无 verdict 的不留。
- keep 生效时关闭该 run 的跨 case 复用；预热池未领用沙箱照常销毁。
- Docker：keep run 创建容器不带 `AutoRemove`，`stop()` 改显式 stop+remove；容器打 `niceeval.kept` 标签。E2B / Vercel：留存 = 不调 kill，算出 `expiresAt` 落注册表。`defineSandbox`：新增可选 `stopDetached(sandboxId)`；未声明时留存照常、附手动清理 diagnostic。
- `result.json` 落 `sandbox: { provider, sandboxId, kept? }`（沙箱型 attempt 无条件写 provider + sandboxId；kept 仅留存时为 true）；`RESULTS_SCHEMA_VERSION` 升一格；留存 attempt 的 `phases` 无 `sandbox.stop` 条目。
- 验收：vitest 覆盖「keep 命中/未命中/中断/超时」四条路径与注册表读写；`pnpm run typecheck`、`pnpm test` 通过。

## 阶段 2：`niceeval sandbox` 命令组

- `sandbox list` / `sandbox stop <id...>` / `sandbox stop --all`：不读 config、不发现 eval，只操作注册表；输出与错误反馈以 `docs/feature/sandbox/cli.md` 的示例为准（空表 `No kept sandboxes.` 退出 0；stop 幂等；id 唯一前缀；歧义/未知报错退出 1；无参数报 `specify sandbox ids or --all`）。
- detached 销毁按注册表条目 `provider` 名路由（docker `rm -f`；e2b / vercel SDK kill）；这层路由只在 CLI/注册表边界，不进 runner/评分路径。
- `list` 核对存活：docker 问 daemon；云 provider 按 `expiresAt` 报 `expired`；`list` 只读不清理。
- 验收：`pnpm run niceeval -- sandbox list` 冒烟；真实 docker 留存一只后 `list` → `stop` 全链路手测。

## 阶段 3：反馈面与残留提醒

- run 收尾输出 Kept sandboxes 块（human / agent / ci 三 profile 都出，走 feedback coordinator，不裸写 stdout/stderr——见 memory `live-raw-stderr-write-desyncs-redraw` 的教训）。
- `niceeval exp` 启动时注册表非空则打一行残留提醒（不阻塞、不清理）。
- 验收：三种 `--output` profile 下留存输出可见且不打散 dashboard。

## 收尾同步义务

- `FLAG_OPTIONS` 新项写 JSDoc（缺注释生成器报错）→ `pnpm docs:reference` 重新生成参考页区块；核对 `src/i18n/` 两份 `--help` 速查是否点名 `--keep-sandbox`（手工体裁，按现有取舍）。
- grep `docs/` 与 `docs-site/` 确认行为与契约一致（本 PLAN 对应契约已先行落稿：`docs/feature/sandbox/cli.md`、`architecture.md`、`docs/cli.md`、`docs/runner.md`、`docs/feature/results/architecture.md`、`docs-site/zh/guides/debug-sandbox.mdx`）。
- 实现中的翻案或反直觉修法记 memory 并索引。

## 统一验收

```bash
pnpm run typecheck
pnpm test
pnpm run niceeval -- --help
pnpm run niceeval -- sandbox list
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

并在真实 eval 仓库（如 `/Users/ctrdh/Code/coding-agent-memory-evals`）里 `pnpm exec niceeval <eval前缀> --agent claude --keep-sandbox` 跑一条会失败的 sandbox eval：核对 run 收尾 Kept sandboxes 块、`docker exec` 能进现场、`result.json` 的 `sandbox` 字段、`niceeval sandbox list` / `stop` 行为与 docs 示例一致。
