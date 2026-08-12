# Assertion Fact API 与 Harness 全链落地 TODO

本计划把 `docs/roadmap/assertion-authoring/` 的目标契约落实到 NiceEval，随后迁移
`/home/ctrdh/Code/NiceEval/NiceEval-Eval/evals/harness`，最终以真实
`pnpm exec niceeval exp harness` 证明两道 Harness 在三个候选版本上都能完成。

这是一棵依赖树，不是分阶段 roadmap。编号只用于表达依赖；满足父节点后，标为 `[P]`
且文件所有权不重叠的节点应同时运行。

## 标记与执行纪律

- `[S]`：串行节点；所列依赖和验收全部完成后才能开始。
- `[P]`：可与同一父节点下其它 `[P]` 节点并行。
- `[T]`：`terra-max-worker`，Codex `gpt-5.6-terra`、`max`。
- `[D]`：`flash-max-worker`，DeepSeek V4 Flash（DP）、`max`。
- `[X]`：会创建真实 Sandbox、调用付费 coding agent 或 Judge 的验收。
- 主 agent 只负责冻结契约、Herdr 编排、独立验收、整合与最终运行，不接手 worker 的实现叶子。
- 第一批同时启动 **2 个 Terra + 2 个 DP**。worker 不得继续分派，不提交、不 push；主 agent
  在 `wait → get/read → 独立验收 → close` 后，按显式路径串行提交已接收的交付。
- 所有 worker 共享同一工作树。未知改动属于用户或其它 agent；不得 reset、clean、restore、stash，
  不得修改自己 ownership 以外的文件。
- 本轮遵守仓库自动化测试重置约束：不新增或恢复 `src/**/*.test.*`、`test/unit/**`、`e2e/**`。
  类型、文档、打包和真实 dogfood 是本次验收面。

## 已核对基线

- 上游当前 `pnpm run typecheck` 通过；它只证明现有运行时与独立的目标类型原型分别能编译，
  不表示两者已经接线。
- 下游 `node_modules/niceeval` 实际解析到
  `/home/ctrdh/.herdr/worktrees/NiceEval/polish-assert`。
- 下游 `pnpm run typecheck` 当前恰有 9 个 Harness 目标 API 错误：缺少
  `commandMatch`、`referencesAnyPath`、`toolMatch`、`changedPaths`、`noChanges`，以及
  `fileChanged(path, options)` 签名未落地。
- 下游 `pnpm exec niceeval exp list harness --json` 当前在 discovery 阶段失败，因为 link 到的
  `dist` 尚未导出 `commandMatch`。因此任何下游改写都必须等上游实现并重新打包后验收。
- `harness` 是 experiment 目录选择器，命中 `harness/v0.9.0`、`harness/v0.12.0`、
  `harness/canary`；每个 Experiment 选择两道 Eval、`attempts: 3`，完整矩阵是 18 个
  coding-agent attempts，另有每道题现存的 Judge 调用。
- 上游 assertion-authoring 文档与 memory 目前有未提交改动；下游三个
  `experiments/harness/*.ts` 也有他人改动。它们在 ownership 明确前都不是 implementation
  worker 可以整理或提交的文件。

## 树形 TODO

- [ ] `[S N0]` 冻结可实施契约和工作树基线

  - [ ] 等 assertion-authoring 文档 owner 完成并提交当前目标契约，记录唯一 commit SHA；
    实现 worker 的 prompt 必须带该 SHA，不得把一边实现一边变化的脏文档当隐式接口。
  - [ ] 逐项关闭实现前的四个接口边界：
    - Match / Fact / use 的公共品牌、`now | final` phase 与 `finishScore()` 返回契约；
    - FactResult / FactUseResult、`invalid | unavailable`、credited score 与 Record schema 升版；
    - logical command v1、tool/event occurrence identity、coverage 三态与 Adapter 责任；
    - Judge 边界以用户最近的显式约束为准：本次不新增 `judge.llm`、不改变
      `turn.judge.autoevals.closedQA()` 的公开签名、默认材料或 rubric 语义。
  - [ ] 若文档仍写成“Judge 也切到新公开 Fact API”，必须先由契约 owner 与用户裁决；worker
    不得自行把 Harness Judge 改成新 API。允许 core 做最小内部桥接以接入新 Record，但
    `src/assertions/judge.ts` 的调用协议和模型行为不在本次重构范围。
  - [ ] 固定废弃面：普通断言不再公开 `.gate/.points/.soft/.optional/.stopOnFailure` 和旧
    selector object；是否保留仅供现有 Judge 的隔离 handle 必须在该 SHA 中写清，不能靠实现猜。
  - [ ] 在两仓库分别记录 `git status --short`，给所有并行改动登记 owner；本计划自己的实现
    不碰下游 `experiments/harness/*.ts` 的既有并行改动。

  验收：

  - `pnpm run typecheck` 通过，包含
    `docs/roadmap/assertion-authoring/reference/type-prototype.ts` 的真实 tsc 证明。
  - `git show <contract-sha>:docs/roadmap/assertion-authoring/README.md` 能独立回答上述边界；
    worker 无需读取未提交 diff 才知道目标 API。

- [ ] `[S N1]` 建立四路实现的公共接口清单（依赖：N0）

  - [ ] 主 agent 把契约中的公共类型、错误分类和 Record 字段整理成 worker prompt 内的精确
    checklist；只引用契约，不另造第三份 API。
  - [ ] 固定四路 ownership；需要改 owner 外的中心文件时，worker 只报告 integration request，
    不跨界顺手修改。
  - [ ] 同时启动以下四个 Herdr worker：

    - `assert-facts-terra`：`[T]` Fact graph、collector 与控制流；
    - `logical-observation-terra`：`[T]` logical occurrence、command projection 与 Adapter 映射；
    - `expect-match-dp`：`[D]` Match 类型和 `niceeval/expect` 工厂；
    - `scoped-sandbox-dp`：`[D]` Sandbox Fact producer；验收后再串行接 scoped occurrence。

  验收：四份 prompt 都写明 preset、父 pane、只允许的文件、禁止再分派、验证命令、Git 边界和
  完成通知；任何两个 worker 的写入路径集合都不相交。

  - [ ] `[P N1-A]` `[T]` 实现 Fact graph、用途登记和控制流

    Ownership：`src/assertions/types.ts`、`src/assertions/collector.ts`、
    `src/assertions/coverage.ts`、`src/context/types.ts`、`src/context/control-flow.ts`。

    - [ ] 实现私有品牌 `BooleanFact` / `ScoreFact`、`now | final`、EvidenceSource 与单次求值缓存。
    - [ ] 实现 `assert`、只接受 now Fact 的 awaited `require`、窄
      `assertIfCovered`、两个不相交的 `score` 签名和 `finishScore()`。
    - [ ] 一个 Fact 最多一个 verdict use 和一个 score use；从用途根正向遍历依赖图识别 dangling
      Fact；requirement 实现 `created → observed-pending → settled` 的受管 thenable，浮空 requirement
      单独成为 author error。
    - [ ] matcher/evaluator defect、`failed`、`unavailable` 和受管控制流不能相互冒充；外部异常
      保留根因，未到达节点记 `notReachedByError`。
    - [ ] 为不改 Judge 公开面的裁决预留 collector 私有 producer bridge，但不编辑
      `src/assertions/judge.ts`；现有 Judge handle 的公开名称、参数、链式契约和传输保持原样。

    验收：目标类型原型通过；本 worker ownership 内 `tsc --noEmit` 不新增错误；交接列出所有
    需要中心 integration 才能闭合的调用点。

  - [ ] `[P N1-B]` `[T]` 实现 logical occurrence 与 command wrapper 归一

    Ownership：`src/o11y/types.ts`、`src/o11y/derive.ts`、`src/o11y/parsers/**`，以及契约明确要求的
    Adapter 原生 argv 映射文件；不得修改 `src/context/**` 或 `src/assertions/**`。

    - [ ] 每笔 tool occurrence 有唯一 identity、原始名称/input coverage、start/finish lifecycle
      与穷尽 command classification。
    - [ ] 只有 Adapter 能从原生协议无歧义取得 argv；compound/dynamic/截断/redacted shell
      直接标 opaque，core 不按工具名、input key 或 raw shell text猜测。
    - [ ] logical-command/v1 精确归一 direct、`pnpm exec`、`pnpm --silent exec` 与无 runner option
      的 `npx`；未知 wrapper form 保留 original、logical opaque。
    - [ ] action coverage 只有在 occurrence、input 和 command classification 都完整时才可 complete；
      只有 start 的 partial stream 不能伪装成 pending。

    验收：用真实 parser fixture/已有 transcript 做只读人工切片，分别展示四种透明 wrapper 得到相同
    logical argv，opaque shell 保持 unavailable；不新增自动化测试文件。

  - [ ] `[P N1-C]` `[D]` 实现统一 Match 内核与公共工厂

    Ownership：`src/expect/**`、`src/assertions/match.ts`；新增内部 matcher 文件也必须留在这两个
    目录，不修改 collector、context 或 o11y。

    - [ ] 实现私有品牌、domain 和 refinement：`BooleanMatch`、`ScoreMatch`、ToolMatch、EventMatch。
    - [ ] 实现 `includes`、`excludes`、`pattern`、value-only `not`、`equals`、Standard Schema
      `matches`、`satisfies(label, predicate)`、`defineValueMatch`、`defineScoreMatch`。
    - [ ] 实现同 domain 的 `and/or`，保留全部子诊断；evaluator defect 不能被短路，三态规则与
      refinement intersection/union 和类型原型一致。
    - [ ] 实现 `referencesAnyPath` 的 plain-JSON string-leaf 与 component 语义，以及
      `toolMatch`、`commandMatch`、`eventMatch` 的单 occurrence matcher；不恢复外部 `match.*`
      namespace、selector object、递归 JSON AST 或匿名 tool/event predicate。
    - [ ] `includes/excludes` 只接受 string，RegExp 只经 `pattern()`；保留 `stripComments` 和稳定
      `lastIndex` 行为。

    验收：独立类型原型对合法 refinement 编译，对跨 domain、ScoreMatch 组合、tool/event `not`
    保持 `@ts-expect-error`；打包前的源码导出清单与目标文档逐项相等。

  - [ ] `[P N1-D]` `[D]` 实现 Sandbox Fact producer

    Ownership：`src/assertions/diff.ts`、`src/context/deferred-file-content.ts`；不得修改
    `src/assertions/scoped.ts` 或中心 `src/context/context.ts`。

    - [ ] `changedPaths`、`noChanges` 共用 exact path-set collector；顺序无意义、重复 expected 是
      author error，added/modified/deleted/净改回均计入 touched set。
    - [ ] `fileChanged` 的 before/after 在同一 change entry 上求值；`file(path)` 一次读取并区分
      missing/非法 UTF-8 的 failed 与 permission/transport/timeout 的 unavailable。

    验收：用现有 diff fixture 进行人工 evaluator probe，覆盖 exact set、同一 entry 与 file source
    错误分类；不添加产品测试文件。

- [ ] `[S N2]` 汇合作用域事实与公开 `t`（依赖：N1-A/B/C/D 全部验收）

  - [ ] `[S N2-A]` `[D]` 实现 scoped occurrence Fact

    Worker：复用 `scoped-sandbox-dp`。Ownership 扩展为 `src/assertions/scoped.ts`；开始前确认
    N1-A/B/C 已冻结可编译的 Fact、occurrence 与 Match 类型。

    - [ ] presence、absence、exact count、`toolOrder/eventOrder` 消费同一 occurrence matcher；order
      使用单调 cursor 和不同 occurrence，只证明子序列，不声称因果或 finish-before-start。
    - [ ] 完整实现 definite / possible path：已知反例可确定失败，partial/opaque 且无确定结论时
      unavailable，不能把没观察到写成不存在。
    - [ ] `calledTool/notCalledTool/toolOrder` 和 event 对应方法共用 candidate evaluator；value matcher
      只经 tool input / event text 等具名 slot 提升 domain。

    验收：用现有 turn fixture 做人工 evaluator probe，覆盖 partial negative、exact count 和 order
    occurrence 不复用；opaque logical command 必须是 unavailable，不得显示成“没有调用”。

  - [ ] `[S N2-B]` `[T]` 汇合到 context、runner 与 package 入口（依赖：N2-A）

    Worker：复用 `assert-facts-terra`。Ownership 扩展为 `src/context/context.ts`、
    `src/context/session.ts`、`src/define.ts`、`src/index.ts`、`src/types.ts`、
    `src/runner/attempt.ts`、`src/runner/types.ts`；开始前重新登记这些中心文件的现有 owner。

    - [ ] `t.check`、scoped receiver、Sandbox、`assert/require/score/finishScore` 全部接入同一个 attempt
      Fact graph；turn snapshot 是 now，attempt aggregate 与最终 diff 是 final。
    - [ ] `send`、Sandbox 操作、`require`、`skip`、`finishScore` 与 test 返回都成为受管边界；正常路径
      的未消费 Fact、未 awaited requirement 和关闭 collector 后登记均给出 author error。
    - [ ] `defineScoreEval.test` 的正常返回类型切到 `ScoreCompletion`；require/skip 的不可达路径保持
      合法；普通 `defineEval` 正常结束必须至少有 verdict use。
    - [ ] 只导出目标 API；删除普通断言旧链和 selector object 的公共导出，不提供兼容糖或双轨语义。
    - [ ] 现有 Autoevals Judge 按 N0 的边界接入，不新增或重命名任何 LLM API。

    验收：`pnpm run typecheck` 通过；在源码消费 fixture 中，目标 Harness 的确定性调用全部有正确
    类型，旧普通 `.points().gate()` 和 selector object 明确编译失败。

- [ ] `[S N3]` 落实新 Record、Verdict、show 与机器出口（依赖：N2）

  Worker：新开或复用一名 `[T]` `fact-record-terra`。Ownership：`src/record/**`、
  `src/shared/verdict.ts`、`src/show/**`、`src/assertions/display.ts`、与 assertion 展示直接相关的
  `src/report/**`、`src/runner/reporters/**`、`src/cli.ts`；不得回改 producer 或 context。

  - [ ] Record schema 升版，所有终态分别保存 `EvaluationFactResult[]` 和 `FactUseResult[]`；旧 schema
    不启发式拼装成新语义。fact evaluator 已经进入后抛错必须是 Attempt errored，不能降成 failed。
  - [ ] 通过制折叠 passed/failed/unavailable/skipped；计分制只要存在已知硬失败就恒为 invalid、
    `creditedScore=0`，后续 unavailable/evaluator error 只追加 issues，不能覆盖已知失败；无已知失败
    时证据不足才是 unavailable、credited score 为 null。
  - [ ] 每个 scored use 必带 earned；`totalScore` 只读 credited score，同题非 null attempt 求均值，
    再跨题求和，不能从诊断 earned score 或旧 `points` 字段旁路聚合。
  - [ ] CLI exit code、JUnit、Artifacts/JSON、首过即停、carry 与报告只消费同一终态映射；移除会在
    运行时改写源码判定语义的 `--strict`。
  - [ ] `niceeval show @locator` 展示 fact、use、matcher tree、coverage reason、occurrence/path 证据和
    score label；opaque command、partial input、negative OR 与 diff unavailable 不得显示成普通失败。
  - [ ] 诊断遵守现有 secret redaction、控制字符清理和预算，不旁路保存未脱敏 input/argv。

  验收：用受控本地 Eval 产生 passed、failed、unavailable、invalid 各一条记录，只通过
  `pnpm exec niceeval show` 和公开 reporter 查看；不直接读取 `.niceeval` 原始文件。

- [ ] `[P N4]` 收口上游公共消费面（依赖：N3）

  Worker：`[D]` `assert-public-dp`。Ownership：`docs/feature/assertions/**`、与此次 API 直接相关的
  `docs-site/**`、`examples/**`、`INDEX.md`、`docs/source-map.md`；不得修改仍由契约 owner 持有的
  `docs/roadmap/assertion-authoring/**` 未验收改动。

  - [ ] 把正式 feature/library、示例与生成参考切到唯一 Fact/Match 写法；删除旧 handle、JsonMatch
    selector 和 `--strict` 普通路径，不再同时展示两套“最终 API”。
  - [ ] 保留高级 value matcher 逃生口和现有非本次 LLM 作者面；不借文档迁移重构 Judge。
  - [ ] 更新 source map 到实际 owner，明确 logical command、Fact graph、scoped evaluator、Record 与
    show 的实现落点。

  验收：`pnpm lint`、`pnpm run typecheck`、`pnpm docs:reference` 后无生成漂移，`git diff --check`
  通过；旧 API 命中只允许存在于 memory、迁移说明或明确历史研究文本。

- [ ] `[S N5]` 构建上游包并验证真实 link（依赖：N3；N4 可并行收尾）

  - [ ] 在 NiceEval 运行 `pnpm run build:package`；若 assertion 展示触及 `src/report/**`，该命令同时
    满足预编译 report runtime 约束。
  - [ ] 在 NiceEval-Eval 再次确认 `readlink -f node_modules/niceeval` 指向本工作树，不以
    `pnpm` 的 “Already up to date” 冒充 dist 已更新。
  - [ ] 从下游进程实际 import `niceeval` 与 `niceeval/expect`，核对 `assert/score` context 类型和
    `and/or/pattern/toolMatch/commandMatch/eventMatch/referencesAnyPath` 的运行时导出。
  - [ ] 运行上游 `pnpm run typecheck`、`pnpm lint`、`git diff --check`。

  验收：下游 `pnpm exec niceeval exp list harness --json` 不再出现 discovery/import 错误；输出恰好
  三个 `harness/*` Experiment，每个 `attempts=3`、`evalCount=2`。

- [ ] `[S N6]` 迁移 NiceEval-Eval 两道 Harness（依赖：N5）

  Worker：`[D]` `harness-migrate-dp`。Ownership 只包括：

  - `evals/harness/terminal-bench/regex-log/eval.ts`
  - `evals/harness/terminal-bench/log-summary/eval.ts`
  - `evals/harness/README.md`

  不修改 `experiments/harness/*.ts`、Fixture、NiceEval core 或其它 Eval。

  - [ ] 每个确定性事实由调用点的 `turn.*` / `t.sandbox.*` 创建，Matcher 直接 inline；不抽共享
    helper、不恢复外部 match namespace、正则 command、JSON AST 或 `eventsSatisfy`。
  - [ ] gate-only 事实使用 `t.assert(fact)`；兼计分事实复用同一 Fact，紧邻写
    `t.assert(fact)` 与 `t.score(label, fact, { max })`，正常尾部 `return t.finishScore()`。
  - [ ] A 保留 toolOrder、禁止 observed tool input 引用 `.niceeval/evals/agents`、turn succeeded、
    exact changed path 与同一 change entry runtime tag；确定性 5 分，现有三个 Judge 共 13 分，
    总分仍为 18，rubric、`{ on }` 材料、候选版本分支和旧 Judge handle 链不变。
  - [ ] B 保留 toolOrder、同一禁区、turn succeeded、noChanges 2 分；现有两个 Judge 各 6 分，
    总分仍为 14，`{ on }` 材料、旧 Judge handle 链、beta/gamma 的 locator、证据和互斥归因要求不变。
  - [ ] 不改中性用户 prompt，不把命令、根因或修复策略泄露给被测 agent；不把内层合法 failed
    当作外层失败。

  验收：下游 `pnpm run typecheck` 的 9 个当前错误归零，且不产生新的 filtered error；
  `pnpm exec niceeval exp list harness --json` 能加载两道 Eval。

- [ ] `[S N7]` 完成零付费的运行前验收（依赖：N4、N6）

  - [ ] 运行 `pnpm exec niceeval docker profile doctor default --smoke`，确认 Docker/Compose、DinD、
    容量与本机权限满足 Harness；失败先修环境，不启动模型。
  - [ ] 运行 `pnpm exec niceeval exp harness --dry --json`，确认矩阵为
    `3 experiments × 2 evals × 3 attempts = 18`，候选版本、flags、Sandbox 和 Judge 配置正确。
  - [ ] dry 必须显示本次需要真实执行 18 个 attempts。若存在 carried/reused，停止并报告；不得擅自
    使用 `--rerun all`、`--accept` 或删除历史结果扩大成本。
  - [ ] 在不输出 secret 的前提下核对 coding-agent 与 Judge credential/endpoint 已解析；完整运行是
    18 个 gpt-5.6-terra coding-agent attempts 加 45 次现有 closedQA Judge 调用（A 27、B 18）。
  - [ ] 本用户请求只授权目标矩阵的一次正式运行，不授权失败后的整批重跑。

  验收：doctor 与 dry 都退出 0；dry 选中范围与预计成本可解释，没有启动 Agent、Judge 或写新 Run。

- [ ] `[X N8]` 真实执行并只用公开 show 诊断（依赖：N7）

  - [ ] 在 NiceEval-Eval 仓库运行且只运行一次：

    ```bash
    pnpm exec niceeval exp harness
    ```

  - [ ] 命令异常、中断或有 attempt 不通过时，不直接 cat/jq/rg `.niceeval`。先运行
    `pnpm exec niceeval show --exp harness/v0.9.0`、`harness/v0.12.0`、`harness/canary` 的公开
    current/history 切片，再按输出给出的 locator 使用 `show @locator --source --execution --diff`。
  - [ ] 只补跑能由 show 证明确实受实现缺陷影响的最小切片；任何整批重跑重新取得用户授权。
  - [ ] 对每个版本核对两题各三次：
    - A outer verdict 全 passed、总分 `18/18`；内层终态 `3 passed / 1 failed / 0 errored`，
      0.9 全量复验、现代版本接受三条并只重跑 delta 的差异由既有 Judge 判断；
    - B outer verdict 全 passed、总分 `14/14`；内层首跑 `1 passed / 2 failed / 0 errored`，
      workspace 无 agent 归因改动，beta/gamma 归因互斥且正确；
    - 所有确定性 Fact 的 assert use 都 passed，没有 unavailable、invalid 或 author error。
  - [ ] 若只补跑一个 failed outer attempt，公开 CLI 退出码仍按该次 Eval 终态非零；历史其它 passed
    结果不得把本次失败折叠为 0。这个重试口径只用真实最小切片验证，不新增自动化测试。

  验收：正式命令退出 0，18 个 outer attempts 全部满足对应满分与 verdict；交接附公开 show 命令和
  摘要，不附私有 Record 内容。

- [ ] `[S N9]` 收尾、提交与 PR 交接（依赖：N8）

  - [ ] 两仓库分别执行约定的 typecheck/lint/diff check，逐仓提交、逐仓说明验证；不把跨仓改动
    混成一个 commit。
  - [ ] 主 agent 逐个回收并关闭本轮创建的全部 Herdr pane/tab；未采用的 worker 交付也要读取、
    说明弃用原因后关闭。
  - [ ] 更新 NiceEval 既有 Assertion PR 的中文标题与正文：按模板保留全部分类，写 before/after、
    用户影响、类型/打包/真实 Harness 证据和未覆盖边界；NiceEval-Eval 的提交单独交接。
  - [ ] 运行 `pnpx frog list` 对账本次可复现摩擦；先查重，只记录绕过但仍需修的真实问题。

  验收：`git show --stat` 只含各节点授权路径；两个仓库剩余 dirty 项都能归属到用户或其它 agent；
  PR/交接能够从契约 SHA、实现 commits、dry 计划和公开 show 证据复现结论。

## 失败即停止的边界

- 目标契约还在未提交 diff 中变化，或 Judge 是否迁移仍有两套说法。
- 四路 worker 需要同时修改同一个中心文件，却没有先回到主 agent 串行整合。
- linked package 没有重建，`exp list harness` 仍从旧 dist 加载。
- dry 不是 18 个实际待执行 attempts，或 Docker profile/凭据/成本无法解释。
- 真实运行失败后只有私有 `.niceeval` 读取才能诊断；这应作为 show 呈现缺口修上游，不能绕过。
