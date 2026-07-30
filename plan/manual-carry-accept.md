# 手动复用标记（--accept）：收尾计划

目标：把「手动标记哪些 attempt 复用、哪些不复用」从已定稿契约推进到全链可用并提交。
契约单源：`docs/feature/experiments/cache.md`（manifest、--accept、整组授权、反事实指纹、值作用域）、
`docs/feature/experiments/cli.md`（--dry 原因与转换分组、TTY 标记定性、零匹配）、
`docs/feature/record/architecture.md`（manifests.json、AcceptedDifference、TimeoutAttribution 两员 trigger）、
`docs/feature/sandbox/architecture.md`（时限归属节）。

已完成（不在本计划内）：
- 契约定稿与周边文档同步；实现切片 A（--accept config: 级 + --dry 门级原因 + 零匹配报错 +
  移除 --carry-ignoring-flag，commit 63877700 / c07c21fc）。
- show @locator 历史寻址 bug：修复已提交（578597b6），memory 条目已落并索引。
- `opaque:no-manifest` 已是合法 selector（`src/runner/manifest.ts` OPAQUE_SELECTOR）。
- `--accept` 不带值的交互层已落地（cli.ts acceptInteractive + `src/runner/accept-prompt.ts`）。
- memory 设计裁决条目（manual-carry-accept-decisions，裁决 1–6）已落并索引。
- 2026-07-30 评审契约修订已落 docs：整组授权、反事实指纹判据、selector 值作用域、
  `--rerun failed` 组合进 cache.md；TTY 交互定性进 cli.md；--dry 转换分组进 cli.md；
  测试文档 record.md 触发层改两员、experiments-runner.md 补三条覆盖类别；教程页补「accept 一半」句。

标注：`[P]` = 与同层其它 [P] 可并行；`[S: n]` = 必须等节点 n 完成。
每个叶子自带验收；worker 完成一个叶子就跑它的验收，不攒到最后。

## 树形 todo

- **1. 切片 B 实现补完**（一条 agent 在跑；接手前先 `git status` + 读工作树分清它已做到哪）
  - 1.1 `[P]` manifests.json 落盘与相减
    - 落点：规划期逐 eval 写 Run 记录根 `manifests.json`（配置面 = ConfigIdentity 字段值；
      源码面/数据面 = 闭包与 loader 文件的「路径 × 内容哈希」，复用指纹已有输入，不二次扫描）。
    - 验收：scratch 项目改一个 share 文件 → `--dry` 出 `stale: source:<路径>`；
      `--accept source:<路径>` 携带且下次 `--dry` 不带 flag 命中；删历史 manifests.json →
      同一差异变 `opaque:no-manifest` 且可显式 accept；单测覆盖
      `docs/engineering/testing/unit/experiments-runner.md` 已声明的 manifest 相减类别。
      注意：该文档示例里的 `runnerFixture` 不存在，实际用手写 fake provider + 计数器
      （memory: testing-doc-runnerfixture-not-implemented）。
  - 1.2 `[P]` `--dry` stale 聚合分组块
    - 形态照 cli.md 示例：selector + 旧新摘要 + `affects N evals` + 可复制 `accept:` 命令行；
      只在有 stale 行时打印；同一 selector 多个旧值按「selector × 旧值→新值」各成一组，
      `accept:` 命令行同一条。
    - 验收：多 eval 同因作废出一个分组块；同 selector 两个旧值出两个分组块；
      `--json` 不受影响（分组是人读投影）。
  - 1.3 `[S: 1.1, 1.2]` 交互标记按修订契约核对
    - 已落地的 accept-prompt 按 cli.md 修订核对三点：选「重跑」= 不授权（无额外语义）；
      选完先打印等价带值命令再执行；非 TTY 不带值维持用法错误并列可授权清单。
    - 验收：注入 fake 输入的单测（选复用 → 携带并留痕；选重跑 → 照常派发）；
      真 TTY 手工走一遍记录输出。
  - 1.4 `[P]` 超时归属
    - (a) provider 单命令无独立默认：未显式传 timeout 时上限 = attempt deadline 剩余量；
      provider 固有会话上限派发前预检，超出报环境约束点名 provider 与值。
    - (b) 超时 errored 落 `TimeoutAttribution`（trigger 两员：attempt-deadline /
      command-timeout；provider 上限不落 attempt），报错行与 `show --timing` 照实印。
    - 验收：scratch 项目造 30s deadline：实验声明生效、不再被 600s 层杀；`result.json` 的
      error 带归属三元组；`--timing` 输出含触发层与来源层；record.md 声明的类别有单测
      （两触发层各一条 + attempt-deadline 四层来源区分力格）。
  - 1.5 `[S: 1.1]` 评审修订的行为对齐
    - 整组授权：一条条目多条差异只授权一半照常重跑（两方向区分力测试）。
    - 反事实指纹：缺 manifest 条目用「重建配置身份 + 本次源码/数据面」重算判等；
      等 → 具名 config 授权即携带；不等 → 需连 `opaque:no-manifest`。
    - 值作用域：同一路径两个旧值一条 selector 全部携带，各自 `carriedAccepting` 记自己的转换。
    - `--accept` × `--rerun failed`：被授权的 failed 仍被口径门拦下重跑，passed 照常携带。
    - 验收：experiments-runner.md 本轮声明的类别各有单测；已有实现与契约不符处改实现不改契约。

- **2. 公开面同步** `[S: 1]`
  - 2.1 `[P]` `pnpm docs:reference` 重生成（cli.ts FLAG_OPTIONS 的 --accept JSDoc 已是终态语义，
    现在就可跑，不必等 1.3）。
    - 验收：`pnpm test:docs-site` 漂移守护绿。
  - 2.2 `[P]` `src/i18n/` 两份 `--help` 速查核对（手工体裁，点名 --accept / --rerun / --dry）。
    - 验收：`pnpm run niceeval -- --help` 两语言输出人工过目。
  - 2.3 `[P]` docs-site 英文入口按中文（`zh/tutorials/rerun-and-cache.mdx` 含本轮补句）与当前代码同步。
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
  - 4.3 `pnpm test:docs`（工作树里另有一条 src 特性线在飞——sandbox-cases/agent-ensure，
    它也改 docs 与 `src/runner/**`；回归先分归属再修，不动它的半成品）。

- **5. 提交** `[S: 全部]`（串行，最后做）
  - 一批：契约与实现（`docs/feature/**`、`docs/engineering/testing/unit/{experiments-runner,record}.md`、
    `docs-site/zh/**` 相关页、memory 两个文件、plan 本文件、切片 B 触碰的 src/test 文件）。
  - 纪律：**不用 `src/**` 这类 glob**——并行特性线与本线同时改 `src/runner/**`，glob 会误吞它的
    半成品；提交前从切片 B agent 的实际触碰集逐文件枚举，`git add <路径>` 后**立即**提交
    （共享暂存区台账，memory: parallel-agents-shared-git-index / git-commit-pathspec）；
    同文件被两线穿插改动时，等对方线结束再提交；commit message 写行为与理由，不写 update。
  - 验收：`git show --stat` 只含本轮文件；提交后 `git status` 剩余改动全部可解释为并行线的。

## 验收总口径

功能完成的判据不是测试绿，而是用户场景闭环：改全局 judge model 后，
`--dry` 能说清每格为什么作废，一条 `--accept config:judge.model` 把不该赔的格拿回来，
下次裸跑同一命令自然命中；同样的机制覆盖 source/data/opaque 与 TTY 交互；
accept 一半时未授权差异不搭便车。超时被杀能看出是哪层时限、值从哪来。
以上每条都要有真实终端输出为证，不接受「实现了」三个字。
