# PLAN：执行模式 flag(keep/reuse)与缓存携带、并发 flag 的组合契约

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；每个阶段先满足自己的验收条件，再进入下一阶段。
>
> 来源：2026-07-21 设计审计发现——keep 的两篇用例(hypothesis-loop / outside-workdir)在「刚失败/刚通过、未改动」这个最常见前提下被缓存携带击穿：`failed` / `passed` 是可携带终态,重跑零派发、没有沙箱、没有现场。另发现显式 `--max-concurrency` 与 `--reuse-sandbox` 组合行为未声明(静默钉 1 违反「不静默降级」),以及四个调度 flag 作用域各说各话、`--budget` 的域语义与「总闸」直觉错位。裁决台账：`memory/keep-reuse-carry-insulation-decision.md`。
>
> 范围：①`--keep-sandbox` 与携带的档内豁免；②`--reuse-sandbox` 与缓存双向绝缘的入向 + 显式并发 flag 用法错误(随串行复用实现一起落)；③`--budget` flag JSDoc 的域语义修正。不做：改指纹定义、改携带粒度、改 keep×reuse 互斥(已定稿)、`--window` JSDoc 漂移(独立小修,不属本契约)。

## 开始前必读

1. `CLAUDE.md`：仓库总规则，特别是「先文档后代码」、同步义务表、禁止 feature branch。
2. `docs/runner.md`「缓存:指纹去重」：新增的「执行模式 flag 划走两块例外」一条是本 PLAN 的单源；「预算护栏(budget)」首段是域语义单源。
3. `docs/feature/sandbox/cli.md`「`--keep-sandbox`:跑完留下现场」：留存与携带不相容的档内豁免条。
4. `docs/feature/sandbox/serial-reuse.md`「串行是本质,不是附带限制」(显式 `--max-concurrency` 用法错误、环境层覆盖为 1)与「与留存、缓存、重试的组合」(双向绝缘)。
5. 覆盖登记：`docs/engineering/testing/unit/experiments-runner.md`「超时、缓存与指纹」的执行模式携带豁免条目；`docs/engineering/testing/unit/sandbox.md`「串行复用」的双向绝缘与并发用法错误条目——测试只为已声明的覆盖类别而写（规则见 `docs/engineering/testing/unit/registry.md`）。
6. 当前实现入口：`src/runner/fingerprint.ts` + `planCarry`(携带规划,keep 档内豁免挂这里)、`src/cli.ts` `FLAG_OPTIONS`(`keep-sandbox` 已有;`budget` JSDoc 待修;`reuse-sandbox` 未实现)。

## 阶段 1：`--keep-sandbox` 的携带档内豁免(现在可做)

- `planCarry` 收到本次 run 的留存档(`off` / `failed` / `all`)：历史终态 verdict 落在当前留存档内的 attempt 不进携带、照常派发(`failed` 档豁免 `failed`;`all` 档豁免 `passed` + `failed`);档外照常携带。`errored` 本就不缓存,行为不变。
- reused 计数、PLAN 面板复用行与真实调度共用同一次 planCarry 判断(既有约束,别拆开)。
- 验收：`experiments-runner.md`「超时、缓存与指纹」的携带豁免类别有测试指认并变绿；`pnpm run typecheck`、`pnpm test` 通过；真实冒烟(`/Users/ctrdh/Code/coding-agent-memory-evals`)：一条失败 eval 不改任何东西直接 `--keep-sandbox` 重跑,确认真实派发且收尾出现 KEPT SANDBOXES 面板。

## 阶段 2：`--budget` JSDoc 域语义(现在可做)

- `src/cli.ts` `FLAG_OPTIONS.budget` 的 JSDoc 改为按域语义表述(「每个 experiment(budget 域)各自的花费上限,到顶停止向该域派发;不是一次调用的总闸」),与 `docs/runner.md` 预算护栏首段一致。
- 跑 `pnpm docs:reference` 重新生成参考页区块;核对 `src/i18n/` 两份 `--help` 速查是否点名了 budget、表述是否需要同步。
- 验收：`pnpm test`(reference-consistency 漂移守护)通过。

## 阶段 3：`--reuse-sandbox` 侧(随串行复用实现落地)

- 复用 run 的携带规划恒为空：不消费携带,计划内每个 attempt 真实派发(入向绝缘;出向的 `reuse` 标记按 serial-reuse.md 既有契约)。
- argv 校验：显式 `--max-concurrency` 与 `--reuse-sandbox` 组合报用法错误(stderr、非零退出、创建沙箱前),与值无关;`NICEEVAL_MAX_CONCURRENCY` / 配置 / provider 推荐值被覆盖为 1,PLAN 与启动反馈标注。
- `--force` 与 `--reuse-sandbox` 组合合法且无额外行为(没有携带可关)。
- 验收：`sandbox.md`「串行复用」的双向绝缘与并发用法错误类别有测试指认并变绿。
