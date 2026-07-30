# 手动复用标记（--accept）：收尾计划

目标：把「手动标记哪些 attempt 复用、哪些不复用」从已定稿契约推进到全链可用并提交。
契约单源：`docs/feature/experiments/cache.md`（manifest、--accept 两节）、
`docs/feature/experiments/cli.md`（--dry 原因、TTY 标记、零匹配）、
`docs/feature/record/architecture.md`（manifests.json、AcceptedDifference、TimeoutAttribution）、
`docs/feature/sandbox/architecture.md`（时限归属节）。
已完成（不在本计划内）：契约定稿、周边文档同步、实现切片 A（--accept config: 级 + --dry 门级原因 + 零匹配报错 + 移除 --carry-ignoring-flag）、show @locator 历史寻址 bug 修复。

标注：`[P]` = 与同层其它 [P] 可并行；`[S: n]` = 必须等节点 n 完成。
每个叶子自带验收；worker 完成一个叶子就跑它的验收，不攒到最后。

## 树形 todo

- **1. 切片 B 实现**（一条 agent 正在跑；若中断按下述四叶补完，落点见各叶）
  - 1.1 `[P]` manifests.json 落盘与相减
    - 落点：规划期逐 eval 写 Run 记录根 `manifests.json`（配置面 = ConfigIdentity 字段值；
      源码面/数据面 = 闭包与 loader 文件的「路径 × 内容哈希」，复用指纹已有输入，不二次扫描）。
    - 差异支：历史侧有 manifest → `source:<路径>` / `data:<路径>`；缺 → `opaque:no-manifest`
      转正为合法 selector（切片 A 当空转报错，需改）。重锚/留痕走切片 A 管线。
    - 验收：scratch 项目改一个 share 文件 → `--dry` 出 `stale: source:<路径>`；
      `--accept source:<路径>` 携带且下次 `--dry` 不带 flag 命中；删历史 manifests.json →
      同一差异变 `opaque:no-manifest` 且可显式 accept；单测覆盖
      `docs/engineering/testing/unit/experiments-runner.md` 已声明的 manifest 相减类别。
  - 1.2 `[P]` `--dry` stale 聚合分组块
    - 形态照 cli.md 示例：selector + 旧新摘要 + `affects N evals` + 可复制 `accept:` 命令行；
      只在有 stale 行时打印。
    - 验收：多 eval 同因作废时人读输出出现一个分组块；`--json` 不受影响（分组是人读投影）。
  - 1.3 `[S: 1.1, 1.2]` `--accept` 不带值的 TTY 逐原因标记
    - stderr 是 TTY → 计划后按差异分组逐条问「复用/重跑」，只问可 accept 的组；
      选完先打印等价带值命令再执行。非 TTY 维持用法错误。readline 实现，不引新依赖。
    - 验收：交互层薄封装注入 fake 输入的单测（选复用 → 携带并留痕；选重跑 → 照常派发）；
      真 TTY 手工走一遍截图/记录输出。
  - 1.4 `[P]` 超时归属
    - (a) provider 单命令无独立默认：未显式传 timeout 时上限 = attempt deadline 剩余量；
      provider 固有会话上限派发前预检，超出报环境约束点名 provider 与值。
    - (b) 超时 errored 落 `TimeoutAttribution`（trigger/limitMs/source），报错行与
      `show --timing` 照实印。
    - 验收：scratch 项目造 30s deadline：实验声明生效、不再被 600s 层杀；`result.json` 的
      error 带归属三元组；`--timing` 输出含触发层与来源层；record.md 声明的落盘类别有单测。

- **2. 公开面同步** `[S: 1]`
  - 2.1 `[P]` `pnpm docs:reference` 重生成（--accept 语义在 1.3 后有变：可不带值）。
    - 验收：`pnpm test:docs-site` 漂移守护绿。
  - 2.2 `[P]` `src/i18n/` 两份 `--help` 速查核对（手工体裁，点名 --accept / --rerun / --dry）。
    - 验收：`pnpm run niceeval -- --help` 两语言输出人工过目。
  - 2.3 `[P]` docs-site 英文入口按中文（`zh/tutorials/rerun-and-cache.mdx` 已定稿）与当前代码同步。
    - 验收：`PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm test:docs-site` 全绿。

- **3. 真实 repo 验收** `[S: 1]`（在 `/Users/ctrdh/Code/MemoryBench`，只 `--dry`，不烧 attempt）
  - 3.1 `[P]` `pnpm exec niceeval exp compare/codex toggl-cli/ --dry`：18 格逐行有原因
    （sandboxReuse 的 12 格标 `sandbox-reuse`，judge 作废的标 `stale: config:judge.model` 分组）。
  - 3.2 `[S: 3.1]` `--accept config:judge.model --dry`：carried 数从 1 跳到 6 上下
    （baseline 5 格回归 + 已在新 judge 下跑完的 1 格）；真跑与否由用户决定，plan 不含烧钱步骤。
  - 3.3 `[P]` `--history` 印出的历史 locator 逐条 `show @<locator>` 能开（bug 修复的真实面复验）。
  - 验收：三条的终端输出贴进任务回执；与 docs 预期不符处报回，不改契约。

- **4. 仓库守护全绿** `[S: 1, 2]`
  - 4.1 `pnpm run typecheck` && `pnpm test`。
    - 已知例外：`test/unit/example-tiers.test.ts` 既有漂移（早于本轮）。
  - 4.2 `[P]` examples tier 漂移裁决：先读 memory 的 tier-sync 与 gen-diff 条目再决定
    跑不跑 `pnpm tiers:sync`（有覆盖手工修订的前科）；修不动就单独报回给用户裁决。
    - 验收：`pnpm test` 全绿，或明确记录「留给用户」的一句话与理由。
  - 4.3 `pnpm test:docs`（注意工作树里有并行 docs 重排线，回归要先分归属再修）。

- **5. 过程沉淀** `[P]`（与 2/3/4 并行，不依赖代码）
  - 5.1 memory 设计裁决条目 + INDEX 挂行：
    - `--carry-ignoring-flag` 被 `--accept config:flags.<key>` 吸收（曾选方案/否决理由/日期）。
    - roadmap 的 `--rerun eval:<prefix>` 因 CLI 两类输入模型被砍。
    - judge/sandbox 组内差异**整组回滚**才携带的实现语义（保守方向的理由）。
  - 验收：`pnpm test:docs`（memory 索引守护）绿。

- **6. 提交** `[S: 全部]`（串行，最后做；工作树有并行重排线的改动，路径限定分批）
  - 6.1 一批：locator bug（`src/show/index.ts` + 测试 + memory 条目）。
  - 6.2 一批：契约与实现（`docs/feature/**`、`docs/roadmap/evidence-reuse/**`、
    `docs/engineering/testing/unit/{experiments-runner,record}.md`、`docs-site/zh/**` 相关页、
    `src/**`、`test/**`、memory 新条目、plan 本文件）。
  - 纪律：`git add <路径>` 后**立即**提交（共享暂存区台账）；同文件若有并行线半成品，
    等该线结束再提交；commit message 写行为与理由，不写 update；重排线的改动不并入本轮 commit，
    归属留给用户。
  - 验收：`git show --stat` 只含本轮文件；提交后 `git status` 里剩余改动全部可解释为重排线的。

## 验收总口径

功能完成的判据不是测试绿，而是用户场景闭环：改全局 judge model 后，
`--dry` 能说清每格为什么作废，一条 `--accept config:judge.model` 把不该赔的格拿回来，
下次裸跑同一命令自然命中；同样的机制覆盖 source/data/opaque 与 TTY 交互。
超时被杀能看出是哪层时限、值从哪来。以上每条都要有真实终端输出为证，不接受「实现了」三个字。
