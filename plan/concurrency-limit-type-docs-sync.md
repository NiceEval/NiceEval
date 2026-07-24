# 并发限额类型路由与面板 running 语义：docs 收尾同步 TODO 树

## 背景与边界

2026-07-24 真机现象:`niceeval exp compare/bub --max-concurrency 3` 的 live 面板 ACTIVE 出现 5–6 行 `running`,同场多个 attempt 重试预算耗尽、终态 failed(bub 服务端「Concurrency limit exceeded for user」)。裁决:**调度机制无 bug,不改 `src/`**——全局并发位退避让位是定稿设计([experiment-gate-tenure-ruling](../memory/experiment-gate-tenure-ruling.md) 已论证并否决过「全局位也不释放」),缺口全在文档:限额类型(速率型 vs 并发型)没有路由、面板 `running` 计数语义没有声明。台账见 [backoff-slot-release-defeats-agent-user-concurrency-cap](../memory/backoff-slot-release-defeats-agent-user-concurrency-cap.md)。

核验入口:

- 调度语义单源:`docs/runner.md#调度:有界并发`
- 退避与槽位契约:`docs/feature/error-classification/architecture.md#退避与槽位`
- 并发用例手册:`docs/feature/experiments/use-case/{concurrency,max-concurrency}.md`
- live 面板体裁契约:`docs/feature/experiments/cli.md`(计数行 + ACTIVE 区)
- 公开站写作规则:`docs-site/AGENTS.md`(改 docs-site 前必读)

**覆盖规范声明:本计划零代码变更,不新增任何单测覆盖类别**(`docs/engineering/testing/unit/` 无需登记)。实现 Agent 只改文档与做真机验收,不写测试、不动 `src/`。

**范围外**:`docs/engineering/testing/unit/experiments-runner.md` 现有断链(→ `memory/run-test-harness-must-isolate-niceeval-root.md`,该文件不在仓库 memory/ 里)属并行进行的 case-lock 工作(`plan/exp-case-lock.md`),会让 `test/docs-consistency.test.ts` 的链接用例红;**不要顺手修**,验收时把这条豁免出去。

## TODO 树

依赖写在节点上;标「可并行」的兄弟子树可由不同 worker 同时做。B 内部同文件内串行、跨文件并行。

- [x] **0. docs/ 核心四处**(已完成,列出供上下文,worker 不用动)
  - [x] 0.1 `docs/runner.md#调度:有界并发` — 全局位 bullet 补「让位后对外压力不降,不加压是实验级闸语义」;解析链段按限额类型路由
  - [x] 0.2 `docs/feature/error-classification/architecture.md#退避与槽位` — 槽位行补「保吞吐不保降压、running 可超上限、要不加压用实验级闸」
  - [x] 0.3 `use-case/max-concurrency.md` — 面板读法补 running≠持位数;边界补并发型限额贴线条目
  - [x] 0.4 `use-case/concurrency.md` — 路由表加并发型限额一行;用例 4 扩到单实验;用例 8 按限额类型分流

- [ ] **A. `docs/feature/experiments/cli.md` 面板计数契约同步**(无依赖;可与 B、C 并行)
  - [ ] A.1 计数行契约段(「互斥计数」与「首行固定使用 total/reused/running/…」两处)落一条**统一原则**,不写成孤立补丁句:计数反映 attempt 的**进度状态**,不反映并发位持有——并发位任一时刻的持有数 ≤ 上限,但计数按 attempt 走到哪算:未开始执行的等待计 `queued`(等本进程并发位、等实验级 setup)或 `elsewhere`(等并行 Invocation 的用例锁,契约已在同文件「等待并发 run 的显示」);已开始执行的内部等待(turn 退避睡眠,ACTIVE 行形如 `turn retry n/m (rate_limit) — waiting Ns`)仍计 `running` 但不持位——`running` 因此可超过全局并发上限,超出行数恰等于正在退避的行数。与用例锁小节「两种等待不混进同一个数字」同一措辞体系;`use-case/max-concurrency.md` 已写的读法保持引用一致,单源留 cli.md
  - [ ] A.2 核对 cli.md 全文既有等待态叙述(「等待 setup 计 queued」、`elsewhere` 小节、计数恒等式三处)与 A.1 统一原则无矛盾、无重复定义
  - [ ] A.3 逐句自测:不写差分句、不写「现已改为」;受影响小节整段重写

- [ ] **B. docs-site 同步**(无依赖;可与 A、C 并行;动手前先读 `docs-site/AGENTS.md`,中文先定稿)
  - [ ] B.1 `zh/explanation/runner.mdx`(与 B.2、B.3 可并行)— 退避重试段(现有「等待重试的 Attempt 会把全局并发名额让给别的 Attempt」一句附近)补两点:面板 running 行数会超过 `--max-concurrency`(正常现象,不是并发失控);agent 服务端按用户计并发 run 数的限额,用实验里的 `maxConcurrency` 压而不是全局 flag。口语化,过「口语测试」
  - [ ] B.2 `zh/troubleshooting/debugging.mdx`(可并行)— 现有限流条目只覆盖 `sandbox.create`(provisioning)侧;新增 agent turn 侧条目:症状=ACTIVE 反复 `turn retry (rate_limit)`、attempt 终态 failed 且 message 带「Concurrency limit exceeded」类措辞;排查路由=分清限额类型,速率型降 `--max-concurrency`,并发型在实验文件里配 `maxConcurrency`(或全局降到限额以下留余量);速查表同步加一行
  - [ ] B.3 `zh/tutorials/write-experiment.mdx`(可并行)— `maxConcurrency` 现只出现在串行(=1)场景;在该字段的讲法处补「降速」用法一句:agent 限额低就配 `maxConcurrency: N`,被限流退避时不会向本实验放行更多 attempt。演示体裁(show, don't spec),不搬 docs/ 的契约散文
  - [ ] B.4 英文入口同步(依赖 B.1–B.3 定稿)— 按中文与当前代码核对后同步对应英文页;没有对应英文页的不新造
  - [ ] B.5 frontmatter 检查(依赖 B.1–B.4)— 改过的 zh 页保持任务视角 title/description 完整(包根 `INDEX.md` 生成依赖它)

- [ ] **C. 真机验收:MemoryBench `compare/bub`**(无依赖;可与 A、B 并行;是文档新路由声明的实证)
  - [ ] C.1 在 MemoryBench(`/Users/ctrdh/Code/MemoryBench`)的 compare/bub 实验文件里加 `maxConcurrency: 3`,原命令重跑 `pnpm exec niceeval exp compare/bub --max-concurrency 3`(已完成终态按指纹携带,只补挂掉的)。改的是用户仓库的实验文件,先向用户确认或用临时实验文件
  - [ ] C.2 观察判据(全部满足才算过):
    - ACTIVE 区任一帧 attempt 行数 ≤ 3(实验闸退避不释放,睡眠者不再腾位给新 attempt)
    - 全程不再出现「Concurrency limit exceeded」的终态 failed;若仍偶发 `turn retry (rate_limit)`,重试应在预算内成功(退避期间本实验不加压,agent 侧限额有机会腾出)
    - 面板互斥计数恒等式每帧成立(`total = reused + running + queued + completed`)
  - [ ] C.3 结果回填:验收通过则在台账 memory 条目正文补一行真机回归记录;判据不满足(尤其 ACTIVE 仍 >3 行)说明实现与 experiment-gate-tenure-ruling 的契约有出入——**这是真 bug,停下回报,不要改文档迁就现象**

- [ ] **D. 收口**(依赖 A、B、C 全部完成;串行)
  - [ ] D.1 `pnpm test` 全量(memory / docs 一致性)——docs-consistency 的链接用例若只红「范围外」声明的那一条既有断链,视为通过并在回报里注明;红出第二条则是本计划引入的,必须修
  - [ ] D.2 `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate` 与 `pnpm run docs:links`(B 子树的守护)
  - [ ] D.3 提交:main 直推,commit message 写清「并发限额类型路由与面板 running 语义的文档同步」与动因,不写 update 类空消息;提交前 `git status`/`git diff` 确认不夹带并行 agent 的 case-lock 文件(`docs/engineering/testing/unit/experiments-runner.md`、`memory/case-lock-*` 等)

## 并行/串行总览

- **A、B、C 三棵子树互相独立,可派三个 worker 并行**。
- B 内:B.1 / B.2 / B.3 不同文件可并行,B.4(英文)与 B.5(frontmatter)串行在后。
- D 串行收口,等 A、B、C 全绿。
- C.3 若发现契约不符,升级为独立 bug 工作流,本计划其余节点不受阻塞(文档写的是目标契约)。

## 验收标准(整计划)

1. 拿任一改动后的文段给没读过旧稿的人:限额类型如何选工具、面板 running 为什么会超上限,不需要任何历史背景就能读懂(docs 写作自测)。
2. `docs/` 与 `docs-site/zh` 对「速率型 vs 并发型」的路由结论一致,且都指向实验级 `maxConcurrency` 作为并发型限额的答案;英文页与中文一致。
3. D.1 / D.2 守护全绿(范围外那条既有断链除外)。
4. C 的真机判据三条全过,台账 memory 条目回填回归记录。
